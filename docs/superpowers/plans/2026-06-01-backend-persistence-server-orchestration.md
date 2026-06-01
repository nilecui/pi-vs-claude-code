# 后端 API + SQLite + 服务端编排(子项目 B)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 新增自托管 Bun 后端,在服务端运行编排(复用 A 的 `runScenario`),把场景/运行/产出落 SQLite,经 REST + SSE 暴露;前端退化为薄客户端。

**Architecture:** 单一 Bun 服务 `apps/coms-dashboard/server/`(吸收 spawner),内置 hub 客户端 + 服务端解释器 + bun:sqlite + 每-run 的 SSE 广播。前端经 `/api` 读场景、起运行、订阅 run 事件。

**Tech Stack:** Bun(`Bun.serve`、`bun:sqlite`)、TypeScript、`bun test`;前端 React18 + Zustand + Vite。

**Spec:** `docs/superpowers/specs/2026-06-01-backend-persistence-server-orchestration-design.md`
**Branch:** `coms-dashboard-orchestration-core`(B 在 A 之上)
**工作目录:** 后端命令在 `apps/coms-dashboard/` 下跑(`cd apps/coms-dashboard`);后端测试 `bun test server/`。

---

## 文件结构

新建 `apps/coms-dashboard/server/`:

| 文件 | 职责 |
|---|---|
| `server/index.ts` | `Bun.serve` 入口 + 路由 + CORS;装配 db/hubClient/runner/runHub |
| `server/db.ts` | bun:sqlite:建表、seed、scenarios/runs/run_steps CRUD(纯函数,传入 Database) |
| `server/hubConfig.ts` | 发现 hub URL + token(读 `~/.pi/coms-net/projects/default/server.secret.json`) |
| `server/hubClient.ts` | 注册/心跳/SSE 消费/`send`→msg_id/`ask`(msg_id 关联 + 超时) |
| `server/agents.ts` | spawn/kill/list(从 `scripts/agent-spawner.ts` 迁入)+ `spawnMissing` |
| `server/runHub.ts` | 每 runId 的 SSE 订阅者集合 + `broadcast` + 快照 |
| `server/runner.ts` | `startRun`:createRun → `runScenario`(deps 接 hubClient/agents/db/runHub)→ 落库 + 广播 |

复用(import,不改):`src/lib/orchestration/{runScenario,validate,types}.ts`。`src/lib/orchestration/scenarios.ts` 仅作 seed 源。
前端(B2):新增 `src/api/client.ts`;改 `src/components/ScenarioChat.tsx`、`src/store.ts`。

依赖:`server/` 引用 `src/lib/orchestration/*` 与 `src/types.ts`(相对路径 `../src/...`)。无新增 npm 依赖(bun:sqlite 内置)。

---

# 阶段 B1 · 后端
（Tasks 1–7,见下;B2 前端迁移 Tasks 8–10 在 B1 全绿后进行)

### Task 1: 服务骨架 + justfile + Vite 代理

**Files:**
- Create: `apps/coms-dashboard/server/index.ts`
- Modify: `justfile`(加 `server` 任务)
- Modify: `apps/coms-dashboard/vite.config.ts`(加 `/api` 代理)
- Create: `apps/coms-dashboard/server/.gitignore`(忽略 `data/`)

- [ ] **Step 1: server 骨架(health + CORS + 404 路由)**

```ts
// apps/coms-dashboard/server/index.ts
const PORT = Number(process.env.COMS_SERVER_PORT) || 5274;

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
}
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: cors() });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method === "GET" && url.pathname === "/api/health") return json({ ok: true, port: PORT });
  return json({ ok: false, error: "not found" }, 404);
}

Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: handle });
console.log("[coms-server] listening on http://127.0.0.1:" + PORT);
```

- [ ] **Step 2: .gitignore + justfile + vite proxy**

`apps/coms-dashboard/server/.gitignore`:
```
data/
```

In `justfile`, replace the `spawner` recipe (or add alongside) with:
```
# Single backend service (API + SQLite + hub client + server-side orchestration + spawn).
server:
    cd apps/coms-dashboard && bun run server/index.ts
```

In `apps/coms-dashboard/vite.config.ts`, inside `server.proxy`, ADD a `/api` entry (keep `/v1` and `/spawner`):
```ts
      "/api": {
        target: `http://127.0.0.1:${process.env.COMS_SERVER_PORT ?? 5274}`,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyRes", (proxyRes) => {
            if ((proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
```

- [ ] **Step 3: 验证**

Run: `cd apps/coms-dashboard && bun run server/index.ts &` then `sleep 1 && curl -s localhost:5274/api/health`
Expected: `{"ok":true,"port":5274}`. Then `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add apps/coms-dashboard/server/index.ts apps/coms-dashboard/server/.gitignore apps/coms-dashboard/vite.config.ts justfile
git commit -m "feat(server): Bun service skeleton + /api proxy + just server"
```

---

### Task 2: SQLite 层(建表 + seed + CRUD)

**Files:**
- Create: `apps/coms-dashboard/server/db.ts`
- Test: `apps/coms-dashboard/server/db.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/coms-dashboard/server/db.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, seedScenarios, listScenarios, getScenario, upsertScenario, deleteScenario,
         createRun, updateRunStatus, upsertRunStep, getRun, listRuns } from "./db";
import type { ScenarioDef } from "../src/lib/orchestration/types";

function freshDb() { const db = new Database(":memory:"); migrate(db); return db; }
const demo: ScenarioDef = {
  id: "x", title: "X", blurb: "b",
  roles: [{ name: "a", provider: "p", model: "m", purpose: "", color: "#000" }],
  input: { label: "l", default: "d" },
  steps: [{ id: "s1", role: "a", prompt: "{{input}}", after: [] }],
};

test("migrate + seed 写入内置场景且幂等", () => {
  const db = freshDb();
  const builtins: ScenarioDef[] = [demo, { ...demo, id: "y" }];
  seedScenarios(db, builtins);
  seedScenarios(db, builtins); // 第二次不应重复
  expect(listScenarios(db).map((s) => s.id).sort()).toEqual(["x", "y"]);
  expect(listScenarios(db).every((s) => s.builtin === 1)).toBe(true);
});

test("upsert / get / delete 自定义场景", () => {
  const db = freshDb();
  upsertScenario(db, demo, false);
  expect(getScenario(db)?.id).toBeUndefined(); // getScenario 需要 id 参数
  const got = getScenario(db, "x");
  expect(got?.steps[0].id).toBe("s1");
  deleteScenario(db, "x");
  expect(getScenario(db, "x")).toBeNull();
});

test("run + steps 读写与状态更新", () => {
  const db = freshDb();
  upsertScenario(db, demo, false);
  const runId = createRun(db, "x", "input-text");
  upsertRunStep(db, runId, "s1", "a", "running", undefined);
  upsertRunStep(db, runId, "s1", "a", "done", "out-1");
  updateRunStatus(db, runId, "done", "FINAL");
  const run = getRun(db, runId);
  expect(run?.status).toBe("done");
  expect(run?.result_md).toBe("FINAL");
  expect(run?.steps.length).toBe(1);
  expect(run?.steps[0].status).toBe("done");
  expect(run?.steps[0].output).toBe("out-1");
  expect(listRuns(db, "x").length).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 3: 写实现**

```ts
// apps/coms-dashboard/server/db.ts
import { Database } from "bun:sqlite";
import type { ScenarioDef } from "../src/lib/orchestration/types";

export type RunStatus = "running" | "done" | "error" | "aborted";
export type StepStatus = "pending" | "running" | "done" | "error" | "timeout";

export interface ScenarioRow { id: string; title: string; blurb: string; builtin: number; }
export interface RunStepRow { step_id: string; role: string; status: StepStatus; output: string | null; }
export interface RunRow {
  id: string; scenario_id: string; input: string; status: RunStatus;
  result_md: string | null; created_at: number; finished_at: number | null; steps: RunStepRow[];
}

export function migrate(db: Database): void {
  db.run("PRAGMA journal_mode=WAL");
  db.run(`CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, blurb TEXT NOT NULL, data TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL,
    result_md TEXT, created_at INTEGER NOT NULL, finished_at INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
    role TEXT NOT NULL, status TEXT NOT NULL, output TEXT, started_at INTEGER, finished_at INTEGER)`);
  db.run("CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id)");
}

export function seedScenarios(db: Database, builtins: ScenarioDef[]): void {
  const exists = db.query("SELECT COUNT(*) AS n FROM scenarios").get() as { n: number };
  if (exists.n > 0) return; // 幂等:已有则不重复 seed
  for (const s of builtins) upsertScenario(db, s, true);
}

export function listScenarios(db: Database): ScenarioRow[] {
  return db.query("SELECT id, title, blurb, builtin FROM scenarios ORDER BY builtin DESC, title").all() as ScenarioRow[];
}

export function getScenario(db: Database, id?: string): ScenarioDef | null {
  if (!id) return null;
  const row = db.query("SELECT data FROM scenarios WHERE id = ?").get(id) as { data: string } | null;
  return row ? (JSON.parse(row.data) as ScenarioDef) : null;
}

export function isBuiltin(db: Database, id: string): boolean {
  const row = db.query("SELECT builtin FROM scenarios WHERE id = ?").get(id) as { builtin: number } | null;
  return !!row && row.builtin === 1;
}

export function upsertScenario(db: Database, s: ScenarioDef, builtin: boolean): void {
  const now = Date.now();
  db.run(
    `INSERT INTO scenarios (id, title, blurb, data, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, blurb=excluded.blurb,
       data=excluded.data, updated_at=excluded.updated_at`,
    [s.id, s.title, s.blurb, JSON.stringify(s), builtin ? 1 : 0, now, now],
  );
}

export function deleteScenario(db: Database, id: string): void {
  db.run("DELETE FROM scenarios WHERE id = ?", [id]);
}

export function createRun(db: Database, scenarioId: string, input: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO runs (id, scenario_id, input, status, created_at) VALUES (?, ?, ?, 'running', ?)",
    [id, scenarioId, input, Date.now()]);
  return id;
}

export function updateRunStatus(db: Database, runId: string, status: RunStatus, resultMd?: string): void {
  db.run("UPDATE runs SET status = ?, result_md = ?, finished_at = ? WHERE id = ?",
    [status, resultMd ?? null, Date.now(), runId]);
}

export function upsertRunStep(db: Database, runId: string, stepId: string, role: string,
                              status: StepStatus, output?: string): void {
  const existing = db.query("SELECT id FROM run_steps WHERE run_id = ? AND step_id = ?").get(runId, stepId) as { id: number } | null;
  const now = Date.now();
  if (existing) {
    db.run("UPDATE run_steps SET status = ?, output = ?, finished_at = ? WHERE id = ?",
      [status, output ?? null, status === "running" ? null : now, existing.id]);
  } else {
    db.run("INSERT INTO run_steps (run_id, step_id, role, status, output, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [runId, stepId, role, status, output ?? null, now, status === "running" ? null : now]);
  }
}

export function getRun(db: Database, runId: string): RunRow | null {
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(runId) as Omit<RunRow, "steps"> | null;
  if (!run) return null;
  const steps = db.query("SELECT step_id, role, status, output FROM run_steps WHERE run_id = ? ORDER BY id").all(runId) as RunStepRow[];
  return { ...run, steps };
}

export function listRuns(db: Database, scenarioId?: string): Omit<RunRow, "steps">[] {
  if (scenarioId) {
    return db.query("SELECT * FROM runs WHERE scenario_id = ? ORDER BY created_at DESC").all(scenarioId) as Omit<RunRow, "steps">[];
  }
  return db.query("SELECT * FROM runs ORDER BY created_at DESC").all() as Omit<RunRow, "steps">[];
}

export function abortStaleRuns(db: Database): void {
  db.run("UPDATE runs SET status = 'aborted', finished_at = ? WHERE status = 'running'", [Date.now()]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/db.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/server/db.ts apps/coms-dashboard/server/db.test.ts
git commit -m "feat(server): sqlite layer — migrate/seed/scenario+run CRUD"
```

---

### Task 3: hub 配置发现 + hub 客户端(msg_id 关联)

**Files:**
- Create: `apps/coms-dashboard/server/hubConfig.ts`
- Create: `apps/coms-dashboard/server/hubClient.ts`
- Test: `apps/coms-dashboard/server/hubClient.test.ts`

- [ ] **Step 1: hubConfig(无测试,纯发现)**

```ts
// apps/coms-dashboard/server/hubConfig.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// 发现 hub base URL + token,优先环境变量,再读 server.secret.json / server.json。
export function discoverHub(): { baseUrl: string; token: string } {
  let baseUrl = process.env.PI_COMS_NET_SERVER_URL ?? "";
  let token = process.env.PI_COMS_NET_AUTH_TOKEN ?? "";
  const dir = join(homedir(), ".pi", "coms-net", "projects", "default");
  for (const f of ["server.secret.json", "server.json"]) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (!token && typeof j.token === "string") token = j.token;
      if (!baseUrl) {
        if (typeof j.local_url === "string") baseUrl = j.local_url;
        else if (j.port) baseUrl = `http://${j.host ?? "127.0.0.1"}:${j.port}`;
      }
    } catch { /* ignore malformed */ }
  }
  if (!baseUrl) baseUrl = "http://127.0.0.1:49840";
  return { baseUrl, token };
}
```

- [ ] **Step 2: 写失败测试(用一个假 hubClient 接口,验证 ask 的 msg_id 关联与超时)**

设计:`HubClient` 的 SSE 消费用一个可注入的「事件源」以便测试。构造函数接受 `{ baseUrl, token, connect }`,其中 `connect(onEvent)` 默认连真实 hub,测试时注入假的。`send` 被测试 stub。

```ts
// apps/coms-dashboard/server/hubClient.test.ts
import { expect, test } from "bun:test";
import { HubClient } from "./hubClient";

function makeClient() {
  const emit: { fn: ((e: any) => void) | null } = { fn: null };
  const sent: { role: string; prompt: string; msgId: string }[] = [];
  let counter = 0;
  const client = new HubClient({
    baseUrl: "http://test",
    token: "t",
    connect: (onEvent) => { emit.fn = onEvent; return () => {}; },
    postMessage: async (role, _prompt) => { const msgId = `m${++counter}`; sent.push({ role, prompt: _prompt, msgId }); return msgId; },
  });
  return { client, emit, sent };
}

test("ask 按 msg_id 关联回复", async () => {
  const { client, emit, sent } = makeClient();
  const p = client.ask("worker", "do it", 1000);
  // 模拟 hub 回了一个无关 msg_id,再回正确的
  emit.fn!({ event: "response", data: { sender: { name: "worker" }, msg_id: "other", response: "nope" } });
  emit.fn!({ event: "response", data: { sender: { name: "worker" }, msg_id: sent[0].msgId, response: "yes" } });
  expect(await p).toBe("yes");
});

test("ask 超时返回 TIMEOUT_TEXT", async () => {
  const { client } = makeClient();
  const r = await client.ask("worker", "x", 30);
  expect(r).toBe("(超时:未收到回复)");
});

test("error 事件也能 resolve(按 msg_id)", async () => {
  const { client, emit, sent } = makeClient();
  const p = client.ask("worker", "x", 1000);
  emit.fn!({ event: "response", data: { sender: { name: "worker" }, msg_id: sent[0].msgId, error: "boom" } });
  expect(await p).toContain("boom");
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/hubClient.test.ts`
Expected: FAIL — `Cannot find module './hubClient'`.

- [ ] **Step 4: 写实现**

```ts
// apps/coms-dashboard/server/hubClient.ts
import { TIMEOUT_TEXT } from "../src/lib/orchestration/runScenario";

const PROJECT = "default";

type HubEvent = { event: string; data: any };
type Connect = (onEvent: (e: HubEvent) => void) => () => void; // 返回 disconnect
type PostMessage = (role: string, prompt: string) => Promise<string>; // 返回 msg_id

export interface HubClientOpts {
  baseUrl: string;
  token: string;
  connect?: Connect;       // 默认连真实 hub SSE
  postMessage?: PostMessage; // 默认 POST /v1/messages
  sessionId?: string;
}

function responseText(data: any): string {
  if (data.error != null) return `(错误:${data.error})`;
  const r = data.response;
  if (typeof r === "string") return r;
  if (r && typeof r.text === "string") return r.text;
  return typeof r === "undefined" ? "" : JSON.stringify(r);
}

export class HubClient {
  private waiters = new Map<string, (text: string) => void>();
  private disconnect: (() => void) | null = null;
  private opts: Required<Pick<HubClientOpts, "baseUrl" | "token">> & HubClientOpts;
  private sessionId: string;

  constructor(opts: HubClientOpts) {
    this.opts = opts as any;
    this.sessionId = opts.sessionId ?? crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase();
    const connect = opts.connect ?? ((onEvent) => this.connectReal(onEvent));
    this.disconnect = connect((e) => this.onEvent(e));
  }

  private hdrs(): Record<string, string> {
    return { "content-type": "application/json", ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}) };
  }

  // 真实 hub:注册 + 消费 /v1/events SSE(用 fetch 流手动解析,Bun 无内置 EventSource)。
  private connectReal(onEvent: (e: HubEvent) => void): () => void {
    const ctrl = new AbortController();
    (async () => {
      await fetch(`${this.opts.baseUrl}/v1/agents/register`, {
        method: "POST", headers: this.hdrs(),
        body: JSON.stringify({ project: PROJECT, session_id: this.sessionId, name: "coms-server",
          purpose: "Backend orchestration service", model: "n/a", color: "#7dd3fc", cwd: "server", explicit: true }),
      }).catch(() => {});
      const res = await fetch(`${this.opts.baseUrl}/v1/events?project=${PROJECT}&session_id=${this.sessionId}`,
        { headers: this.hdrs(), signal: ctrl.signal });
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          let ev = "message"; let dataStr = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          try { onEvent({ event: ev, data: JSON.parse(dataStr) }); } catch { /* ignore */ }
        }
      }
    })().catch(() => {});
    return () => ctrl.abort();
  }

  private async postReal(role: string, prompt: string): Promise<string> {
    const res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
      method: "POST", headers: this.hdrs(),
      body: JSON.stringify({ project: PROJECT, sender_session: this.sessionId, target: role,
        target_session: null, prompt, conversation_id: null, response_schema: null, hops: 0 }),
    });
    const j = await res.json();
    return j.msg_id as string;
  }

  private onEvent(e: HubEvent): void {
    if (e.event !== "response" && e.event !== "error") return;
    const msgId = e.data?.msg_id;
    if (!msgId) return;
    const w = this.waiters.get(msgId);
    if (w) { this.waiters.delete(msgId); w(responseText(e.data)); }
  }

  async ask(role: string, prompt: string, timeoutMs: number): Promise<string> {
    const post = this.opts.postMessage ?? ((r, p) => this.postReal(r, p));
    const msgId = await post(role, prompt);
    if (!msgId) return "(发送失败:hub 未接受消息)";
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiters.delete(msgId); resolve(TIMEOUT_TEXT); }, timeoutMs);
      this.waiters.set(msgId, (text) => { clearTimeout(timer); resolve(text); });
    });
  }

  stop(): void { this.disconnect?.(); }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/hubClient.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/server/hubConfig.ts apps/coms-dashboard/server/hubClient.ts apps/coms-dashboard/server/hubClient.test.ts
git commit -m "feat(server): hub client with msg_id-correlated ask + config discovery"
```

---

### Task 4: agents(spawn/kill/list + spawnMissing)

**Files:**
- Create: `apps/coms-dashboard/server/agents.ts`

**说明:** 把 `scripts/agent-spawner.ts` 的 spawn/kill/list 逻辑迁入纯函数,并加 `spawnMissing`(轮询 hub `/v1/agents` 等注册)。`scripts/agent-spawner.ts` 暂保留不删(B2 末或后续清理),避免破坏其它引用。

- [ ] **Step 1: 实现(无独立单测,集成测试覆盖;逻辑直接迁移自现有 spawner)**

```ts
// apps/coms-dashboard/server/agents.ts
import path from "node:path";
import type { RoleDef } from "../src/lib/orchestration/types";

const REPO = path.resolve(import.meta.dir, "..", "..", ".."); // apps/coms-dashboard/server -> repo root

function q(v: unknown): string { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
function sessionName(name: string): string { return `pi-${name.replace(/[^A-Za-z0-9_-]/g, "")}-${Date.now().toString(36)}`; }

export function spawnAgent(opts: { name: string; provider?: string; model?: string; purpose?: string; color?: string }): { ok: boolean; session?: string; error?: string } {
  if (!/^[A-Za-z0-9_-]+$/.test(opts.name)) return { ok: false, error: "invalid name" };
  const parts = ["pi", "-e", `${REPO}/extensions/coms-net.ts`, "-e", `${REPO}/extensions/minimal.ts`,
    "-e", `${REPO}/extensions/theme-cycler.ts`, "--name", q(opts.name)];
  if (opts.provider) parts.push("--provider", q(opts.provider));
  if (opts.model) parts.push("--model", q(opts.model));
  if (opts.purpose) parts.push("--purpose", q(opts.purpose));
  if (opts.color) parts.push("--color", q(opts.color));
  const envFile = `${REPO}/.env`;
  const inner = [`cd ${q(REPO)}`, `[ -f ${q(envFile)} ] && set -a && . ${q(envFile)} && set +a`, parts.join(" ")].join("; ");
  const session = sessionName(opts.name);
  const proc = Bun.spawnSync(["tmux", "new-session", "-d", "-s", session, "bash", "-lc", inner], { env: process.env as Record<string, string> });
  if (!proc.success) return { ok: false, error: new TextDecoder().decode(proc.stderr) };
  return { ok: true, session };
}

export function listSessions(): string[] {
  const proc = Bun.spawnSync(["tmux", "list-sessions", "-F", "#{session_name}"], { env: process.env as Record<string, string> });
  if (!proc.success) return [];
  const out = new TextDecoder().decode(proc.stdout).trim();
  return out ? out.split("\n").filter((s) => s.startsWith("pi-")) : [];
}

export function killSession(session: string): { ok: boolean; error?: string } {
  if (!session.startsWith("pi-")) return { ok: false, error: "session must start with pi-" };
  const proc = Bun.spawnSync(["tmux", "kill-session", "-t", session], { env: process.env as Record<string, string> });
  return proc.success ? { ok: true } : { ok: false, error: new TextDecoder().decode(proc.stderr) };
}

// 起缺失角色并轮询 hub 直到注册或超时。onlineNames 由调用方提供(查询 hub)。
export async function spawnMissing(roles: RoleDef[], onlineNames: () => Promise<Set<string>>, timeoutMs = 50000): Promise<boolean> {
  const online = await onlineNames();
  const missing = roles.filter((r) => !online.has(r.name));
  if (missing.length === 0) return true;
  for (const r of missing) spawnAgent(r);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await Bun.sleep(1000);
    const cur = await onlineNames();
    if (missing.every((r) => cur.has(r.name))) return true;
  }
  return false;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/server/agents.ts
git commit -m "feat(server): agent spawn/kill/list + spawnMissing (migrated from spawner)"
```

---

### Task 5: runHub(每-run SSE 订阅与广播)

**Files:**
- Create: `apps/coms-dashboard/server/runHub.ts`
- Test: `apps/coms-dashboard/server/runHub.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/coms-dashboard/server/runHub.test.ts
import { expect, test } from "bun:test";
import { RunHub } from "./runHub";

test("broadcast 推送给所有订阅者,unsubscribe 后不再收", () => {
  const hub = new RunHub();
  const a: string[] = []; const b: string[] = [];
  const unsubA = hub.subscribe("r1", (e) => a.push(e.type));
  hub.subscribe("r1", (e) => b.push(e.type));
  hub.broadcast("r1", { type: "step" });
  unsubA();
  hub.broadcast("r1", { type: "done" });
  expect(a).toEqual(["step"]);
  expect(b).toEqual(["step", "done"]);
});

test("不同 run 互不串", () => {
  const hub = new RunHub();
  const r1: string[] = [];
  hub.subscribe("r1", (e) => r1.push(e.type));
  hub.broadcast("r2", { type: "step" });
  expect(r1).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/runHub.test.ts`
Expected: FAIL — `Cannot find module './runHub'`.

- [ ] **Step 3: 写实现**

```ts
// apps/coms-dashboard/server/runHub.ts
export interface RunEvent { type: "step" | "status" | "result" | "done" | "error"; [k: string]: unknown; }
type Sub = (e: RunEvent) => void;

export class RunHub {
  private subs = new Map<string, Set<Sub>>();
  subscribe(runId: string, fn: Sub): () => void {
    let set = this.subs.get(runId);
    if (!set) { set = new Set(); this.subs.set(runId, set); }
    set.add(fn);
    return () => { set!.delete(fn); if (set!.size === 0) this.subs.delete(runId); };
  }
  broadcast(runId: string, e: RunEvent): void {
    const set = this.subs.get(runId);
    if (!set) return;
    for (const fn of set) { try { fn(e); } catch { /* ignore one bad subscriber */ } }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/runHub.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/server/runHub.ts apps/coms-dashboard/server/runHub.test.ts
git commit -m "feat(server): per-run SSE pub/sub (RunHub)"
```

---

### Task 6: runner(startRun:跑 A 的解释器 + 落库 + 广播)

**Files:**
- Create: `apps/coms-dashboard/server/runner.ts`
- Test: `apps/coms-dashboard/server/runner.test.ts`

- [ ] **Step 1: 写失败测试(mock hub.ask + 内存 db)**

```ts
// apps/coms-dashboard/server/runner.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, upsertScenario, getRun } from "./db";
import { RunHub } from "./runHub";
import { startRun } from "./runner";
import type { ScenarioDef } from "../src/lib/orchestration/types";

const scn: ScenarioDef = {
  id: "p", title: "P", blurb: "b",
  roles: [{ name: "a", provider: "x", model: "x", purpose: "", color: "#000" },
          { name: "b", provider: "x", model: "x", purpose: "", color: "#000" }],
  input: { label: "l", default: "d" },
  steps: [
    { id: "s1", role: "a", prompt: "{{input}}", after: [] },
    { id: "s2", role: "b", prompt: "{{steps.s1}}", after: ["s1"] },
  ],
  assembly: "R:{{steps.s2}}",
};

function deps() {
  const db = new Database(":memory:"); migrate(db); upsertScenario(db, scn, false);
  const hub = { ask: async (role: string) => `out-${role}` };
  const agents = { spawnMissing: async () => true };
  const runHub = new RunHub();
  return { db, hub, agents, runHub };
}

test("startRun 落库 steps + result,广播 step/result/done", async () => {
  const { db, hub, agents, runHub } = deps();
  const events: string[] = [];
  const runId = await startRun({ db, hub, agents, runHub, scenario: scn, input: "X",
    onSubscribeReplay: false });
  // startRun 返回前已跑完(await);也可订阅前先订阅。这里检查 DB。
  const run = getRun(db, runId)!;
  expect(run.status).toBe("done");
  expect(run.result_md).toBe("R:out-b");
  expect(run.steps.map((s) => s.step_id)).toEqual(["s1", "s2"]);
  expect(run.steps.every((s) => s.status === "done")).toBe(true);
});

test("广播事件序列包含 result 与 done", async () => {
  const { db, hub, agents, runHub } = deps();
  const types: string[] = [];
  const runId0 = "pre"; // 订阅需要 runId;改为先 createRun 再 start 的话需要重构。
  // 用 runHub 全局监听:startRun 内部 broadcast 用真实 runId,这里订阅所有 via wildcard 不支持,
  // 所以改为断言 DB(上一个测试)+ 这里断言 onEvent 回调。
  await startRun({ db, hub, agents, runHub, scenario: scn, input: "X",
    onEvent: (e) => types.push(e.type) });
  expect(types).toContain("result");
  expect(types).toContain("done");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/runner.test.ts`
Expected: FAIL — `Cannot find module './runner'`.

- [ ] **Step 3: 写实现**

```ts
// apps/coms-dashboard/server/runner.ts
import type { Database } from "bun:sqlite";
import { runScenario } from "../src/lib/orchestration/runScenario";
import type { ScenarioDef, RoleDef } from "../src/lib/orchestration/types";
import { createRun, updateRunStatus, upsertRunStep } from "./db";
import type { RunHub, RunEvent } from "./runHub";

export interface RunnerArgs {
  db: Database;
  hub: { ask: (role: string, prompt: string, timeoutMs: number) => Promise<string> };
  agents: { spawnMissing: (roles: RoleDef[]) => Promise<boolean> };
  runHub: RunHub;
  scenario: ScenarioDef;
  input: string;
  onEvent?: (e: RunEvent) => void; // 测试用旁路;生产用 runHub
}

export async function startRun(args: RunnerArgs): Promise<string> {
  const { db, hub, agents, runHub, scenario, input } = args;
  const runId = createRun(db, scenario.id, input);
  const emit = (e: RunEvent) => { runHub.broadcast(runId, e); args.onEvent?.(e); };
  try {
    await runScenario(scenario, input, {
      ask: (role, prompt, timeoutMs) => hub.ask(role, prompt, timeoutMs),
      spawnMissing: (roles) => agents.spawnMissing(roles),
      onStepUpdate: (id, status, text) => {
        const role = scenario.steps.find((s) => s.id === id)?.role ?? "";
        upsertRunStep(db, runId, id, role, status, text);
        emit({ type: "step", stepId: id, role, status, output: text });
      },
      onStatus: (msg) => emit({ type: "status", msg }),
      onResult: (md) => { updateRunStatus(db, runId, "done", md); emit({ type: "result", md }); emit({ type: "done" }); },
    });
  } catch (e) {
    updateRunStatus(db, runId, "error");
    emit({ type: "error", error: String(e) });
  }
  return runId;
}
```

> 注:`runScenario` 在所有步骤终态后调用 `onResult`(A 的实现);若校验/ spawn 失败它只调 `onStatus` 不调 `onResult`,此时 run 仍为 `running` —— 在 Task 7 的路由层,start 之后若未 done 则由 `onStatus` 的失败分支额外置 `error`。简化:在 `onStatus` 收到以「校验失败」「未就绪」开头的消息时,runner 也置 `updateRunStatus(db, runId, "error")`。在实现里对 `onStatus` 加:`if (/校验失败|未就绪|异常中止/.test(msg)) updateRunStatus(db, runId, "error");`

补充实现(把上面注解落到代码):`onStatus: (msg) => { if (/校验失败|未就绪|异常中止/.test(msg)) updateRunStatus(db, runId, "error"); emit({ type: "status", msg }); }`

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/runner.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/server/runner.ts apps/coms-dashboard/server/runner.test.ts
git commit -m "feat(server): startRun — server-side interpreter wired to db + RunHub"
```

---

### Task 7: 路由装配 + 启动接线 + 集成测试

**Files:**
- Modify: `apps/coms-dashboard/server/index.ts`
- Test: `apps/coms-dashboard/server/server.integration.test.ts`

- [ ] **Step 1: 写集成测试(随机端口 + 临时 db + mock hub via 直接调 startRun? 用 HTTP)**

集成测试启动真实 `Bun.serve`,注入一个假的 hub.ask(不连真 hub)。为此 `index.ts` 导出一个 `buildServer({ db, hub, agents })` 工厂(默认参数连真实依赖,测试注入假的)。

```ts
// apps/coms-dashboard/server/server.integration.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, seedScenarios } from "./db";
import { buildServer } from "./index";
import type { ScenarioDef } from "../src/lib/orchestration/types";

const scn: ScenarioDef = {
  id: "demo", title: "Demo", blurb: "b",
  roles: [{ name: "a", provider: "x", model: "x", purpose: "", color: "#000" }],
  input: { label: "l", default: "d" },
  steps: [{ id: "s1", role: "a", prompt: "{{input}}", after: [] }],
  assembly: "R:{{steps.s1}}",
};

function harness() {
  const db = new Database(":memory:"); migrate(db); seedScenarios(db, [scn]);
  const hub = { ask: async (_r: string, _p: string) => "hello" };
  const agents = { spawnMissing: async () => true };
  const handler = buildServer({ db, hub, agents });
  return { handler };
}
async function call(handler: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) {
  return handler(new Request("http://t" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
}

test("GET /api/scenarios 返回 seed 的内置场景", async () => {
  const { handler } = harness();
  const res = await call(handler, "GET", "/api/scenarios");
  const j = await res.json();
  expect(j.scenarios.map((s: any) => s.id)).toContain("demo");
});

test("POST /api/runs 触发服务端编排并落库,GET /api/runs/:id 拿到 result", async () => {
  const { handler } = harness();
  const res = await call(handler, "POST", "/api/runs", { scenarioId: "demo", input: "X" });
  const { runId } = await res.json();
  expect(runId).toBeTruthy();
  // startRun 是 await 完成的(短场景),直接查
  const detail = await (await call(handler, "GET", `/api/runs/${runId}`)).json();
  expect(detail.run.status).toBe("done");
  expect(detail.run.result_md).toBe("R:hello");
});

test("PUT 内置场景被拒(409)", async () => {
  const { handler } = harness();
  const res = await call(handler, "PUT", "/api/scenarios/demo", scn);
  expect(res.status).toBe(409);
});
```

> 注:为让集成测试可断言,`POST /api/runs` 在实现里 `await startRun(...)` 后再返回 `{runId}`(短场景同步完成);真实长场景这会拖住请求 —— 因此生产实现用「不 await,后台跑」。为兼顾两者:`POST /api/runs` 先 `createRun` 拿 runId 并立即返回,后台 `startRun`。但集成测试需要完成后再查。**解决:** `buildServer` 接受可选 `awaitRuns?: boolean`(测试传 true → 同步 await;生产默认 false → 后台跑)。

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/server.integration.test.ts`
Expected: FAIL — `buildServer` 未导出。

- [ ] **Step 3: 实现 buildServer + 路由(重写 index.ts)**

```ts
// apps/coms-dashboard/server/index.ts
import { Database } from "bun:sqlite";
import type { RoleDef, ScenarioDef } from "../src/lib/orchestration/types";
import { validate } from "../src/lib/orchestration/validate";
import { SCENARIOS } from "../src/lib/orchestration/scenarios";
import * as dbm from "./db";
import { RunHub } from "./runHub";
import { startRun } from "./runner";
import { HubClient } from "./hubClient";
import { discoverHub } from "./hubConfig";
import { spawnAgent, killSession, listSessions, spawnMissing } from "./agents";

const PORT = Number(process.env.COMS_SERVER_PORT) || 5274;

function cors(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type", "Content-Type": "application/json" };
}
export function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: cors() }); }

export interface ServerDeps {
  db: Database;
  hub: { ask: (role: string, prompt: string, timeoutMs: number) => Promise<string> };
  agents: { spawnMissing: (roles: RoleDef[]) => Promise<boolean> };
  awaitRuns?: boolean;
}

export function buildServer(deps: ServerDeps): (req: Request) => Promise<Response> {
  const runHub = new RunHub();
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      if (req.method === "GET" && p === "/api/health") return json({ ok: true, port: PORT });

      // ---- scenarios ----
      if (req.method === "GET" && p === "/api/scenarios") return json({ scenarios: dbm.listScenarios(deps.db) });
      if (req.method === "GET" && p.startsWith("/api/scenarios/")) {
        const id = decodeURIComponent(p.slice("/api/scenarios/".length));
        const s = dbm.getScenario(deps.db, id);
        return s ? json({ scenario: s }) : json({ error: "not found" }, 404);
      }
      if (req.method === "POST" && p === "/api/scenarios") {
        const body = (await req.json()) as ScenarioDef;
        const errs = validate(body);
        if (errs.length) return json({ error: "invalid", details: errs }, 400);
        dbm.upsertScenario(deps.db, body, false);
        return json({ ok: true, id: body.id });
      }
      if (req.method === "PUT" && p.startsWith("/api/scenarios/")) {
        const id = decodeURIComponent(p.slice("/api/scenarios/".length));
        if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可改,请先 duplicate" }, 409);
        const body = (await req.json()) as ScenarioDef;
        const errs = validate(body);
        if (errs.length) return json({ error: "invalid", details: errs }, 400);
        dbm.upsertScenario(deps.db, body, false);
        return json({ ok: true });
      }
      if (req.method === "DELETE" && p.startsWith("/api/scenarios/")) {
        const id = decodeURIComponent(p.slice("/api/scenarios/".length));
        if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可删,请先 duplicate" }, 409);
        dbm.deleteScenario(deps.db, id);
        return json({ ok: true });
      }
      if (req.method === "POST" && p.match(/^\/api\/scenarios\/[^/]+\/duplicate$/)) {
        const id = decodeURIComponent(p.split("/")[3]);
        const src = dbm.getScenario(deps.db, id);
        if (!src) return json({ error: "not found" }, 404);
        const copy: ScenarioDef = { ...src, id: `${src.id}-copy-${Date.now().toString(36)}`, title: `${src.title}(副本)` };
        dbm.upsertScenario(deps.db, copy, false);
        return json({ ok: true, id: copy.id });
      }

      // ---- runs ----
      if (req.method === "POST" && p === "/api/runs") {
        const { scenarioId, input } = (await req.json()) as { scenarioId: string; input: string };
        const scenario = dbm.getScenario(deps.db, scenarioId);
        if (!scenario) return json({ error: "scenario not found" }, 404);
        if (deps.awaitRuns) {
          const runId = await startRun({ db: deps.db, hub: deps.hub, agents: deps.agents, runHub, scenario, input });
          return json({ runId });
        }
        // 生产:先建 run 拿 id 立即返回,后台跑
        const runId = dbm.createRun(deps.db, scenarioId, input);
        // 后台执行(复用 startRun 但它会再 createRun —— 改为内部 runExisting)。
        void runExisting({ db: deps.db, hub: deps.hub, agents: deps.agents, runHub, scenario, input, runId });
        return json({ runId });
      }
      if (req.method === "GET" && p === "/api/runs") {
        const sid = url.searchParams.get("scenarioId") ?? undefined;
        return json({ runs: dbm.listRuns(deps.db, sid) });
      }
      if (req.method === "GET" && p.match(/^\/api\/runs\/[^/]+\/events$/)) {
        const runId = decodeURIComponent(p.split("/")[3]);
        return sseForRun(runHub, deps.db, runId);
      }
      if (req.method === "GET" && p.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(p.slice("/api/runs/".length));
        const run = dbm.getRun(deps.db, runId);
        return run ? json({ run }) : json({ error: "not found" }, 404);
      }

      // ---- agents ----
      if (req.method === "POST" && p === "/api/agents/spawn") {
        const b = (await req.json()) as any; return json(spawnAgent(b));
      }
      if (req.method === "POST" && p === "/api/agents/kill") {
        const b = (await req.json()) as { session: string }; return json(killSession(b.session));
      }
      if (req.method === "GET" && p === "/api/agents") return json({ ok: true, sessions: listSessions() });

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  };
}

// 用已建好的 runId 跑(后台路径)。与 startRun 共用逻辑:这里直接调 startRun 的变体。
async function runExisting(a: { db: Database; hub: ServerDeps["hub"]; agents: ServerDeps["agents"]; runHub: RunHub; scenario: ScenarioDef; input: string; runId: string }) {
  // startRun 会 createRun;为复用 runId,改造 startRun 接受可选 runId。见下「Task 6 调整」。
  await startRun({ db: a.db, hub: a.hub, agents: a.agents, runHub: a.runHub, scenario: a.scenario, input: a.input, runId: a.runId });
}

function sseForRun(runHub: RunHub, db: Database, runId: string): Response {
  const headers = { ...cors(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" };
  let unsub = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: { type: string; [k: string]: unknown }) => controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      // 快照:先发已有 steps + 当前状态
      const run = db ? (require("./db") as typeof dbm).getRun(db, runId) : null;
      if (run) { for (const s of run.steps) send({ type: "step", stepId: s.step_id, role: s.role, status: s.status, output: s.output }); if (run.result_md) send({ type: "result", md: run.result_md }); if (run.status !== "running") send({ type: "done" }); }
      unsub = runHub.subscribe(runId, (e) => send(e));
    },
    cancel() { unsub(); },
  });
  return new Response(stream, { headers });
}

// 生产启动:发现 hub、建真实依赖、起 Bun.serve、reset 残留 running。
if (import.meta.main) {
  const dataDir = `${import.meta.dir}/data`;
  Bun.spawnSync(["mkdir", "-p", dataDir]);
  const db = new Database(`${dataDir}/coms.db`);
  dbm.migrate(db);
  dbm.seedScenarios(db, SCENARIOS);
  dbm.abortStaleRuns(db);
  const { baseUrl, token } = discoverHub();
  const hub = new HubClient({ baseUrl, token });
  const onlineNames = async () => {
    const res = await fetch(`${baseUrl}/v1/agents?project=default`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (!res) return new Set<string>();
    const j = await res.json().catch(() => ({ agents: [] }));
    return new Set<string>((j.agents ?? []).map((a: any) => a.name));
  };
  const agents = { spawnMissing: (roles: RoleDef[]) => spawnMissing(roles, onlineNames) };
  const handler = buildServer({ db, hub, agents, awaitRuns: false });
  Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: handler });
  console.log("[coms-server] listening on http://127.0.0.1:" + PORT + " (hub " + baseUrl + ")");
}
```

**Task 6 调整(配合 runId 复用):** 修改 `server/runner.ts` 的 `RunnerArgs` 增加可选 `runId?: string`,`startRun` 改为:`const runId = args.runId ?? createRun(db, scenario.id, input);`(其余不变)。重跑 `bun test server/runner.test.ts` 确认仍过。

> `sseForRun` 里用 `require("./db")` 是为避免顶层循环引用书写;实现时直接用顶部已 import 的 `dbm.getRun(db, runId)` 即可(把 `const run = ...require...` 改为 `const run = dbm.getRun(db, runId);`)。

- [ ] **Step 4: 运行确认通过 + 全套后端测试 + tsc**

Run: `cd apps/coms-dashboard && bun test server/ && bunx tsc --noEmit`
Expected: 全绿(db 3 + hubClient 3 + runHub 2 + runner 2 + integration 3 ≈ 13),tsc 无输出。

- [ ] **Step 5: 真实联调(可选但建议)**

起 `PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server` + `just server`,然后:
```bash
curl -s localhost:5274/api/scenarios | head -c 300
curl -s -XPOST localhost:5274/api/runs -H 'content-type: application/json' -d '{"scenarioId":"hierarchy","input":"用一句话说优先事项"}'
```
观察返回 runId;`curl -N localhost:5274/api/runs/<runId>/events` 看 SSE 流(需要 hub + 在线 agent)。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/server/index.ts apps/coms-dashboard/server/server.integration.test.ts apps/coms-dashboard/server/runner.ts
git commit -m "feat(server): REST+SSE routes, buildServer factory, production bootstrap"
```

---

# 阶段 B2 · 前端迁移(B1 全绿后)

### Task 8: API 客户端 `src/api/client.ts`

**Files:**
- Create: `apps/coms-dashboard/src/api/client.ts`

- [ ] **Step 1: 实现(fetch 封装 + EventSource 助手;走 Vite `/api` 代理)**

```ts
// apps/coms-dashboard/src/api/client.ts
import type { ScenarioDef } from "../lib/orchestration/types";

export interface ScenarioSummary { id: string; title: string; blurb: string; builtin: number; }
export interface RunSummary { id: string; scenario_id: string; input: string; status: string; result_md: string | null; created_at: number; finished_at: number | null; }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

export const api = {
  listScenarios: () => j<{ scenarios: ScenarioSummary[] }>("/api/scenarios").then((r) => r.scenarios),
  getScenario: (id: string) => j<{ scenario: ScenarioDef }>(`/api/scenarios/${encodeURIComponent(id)}`).then((r) => r.scenario),
  createScenario: (s: ScenarioDef) => j<{ ok: boolean; id: string }>("/api/scenarios", { method: "POST", body: JSON.stringify(s) }),
  updateScenario: (id: string, s: ScenarioDef) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(s) }),
  deleteScenario: (id: string) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createRun: (scenarioId: string, input: string) => j<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ scenarioId, input }) }).then((r) => r.runId),
  listRuns: (scenarioId?: string) => j<{ runs: RunSummary[] }>(`/api/runs${scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ""}`).then((r) => r.runs),
  getRun: (runId: string) => j<{ run: any }>(`/api/runs/${encodeURIComponent(runId)}`).then((r) => r.run),
  runEvents: (runId: string) => new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`),
  spawn: (body: { name: string; provider?: string; model?: string; purpose?: string; color?: string }) => j("/api/agents/spawn", { method: "POST", body: JSON.stringify(body) }),
  kill: (session: string) => j("/api/agents/kill", { method: "POST", body: JSON.stringify({ session }) }),
  agents: () => j<{ sessions: string[] }>("/api/agents"),
};
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/src/api/client.ts
git commit -m "feat(web): typed API client + run SSE helper"
```

---

### Task 9: ScenarioChat 改为薄客户端(从 SSE 渲染)

**Files:**
- Modify: `apps/coms-dashboard/src/components/ScenarioChat.tsx`(全量替换)

**说明:** 编排已在后端。组件:① 从 `api.listScenarios` 填下拉、`api.getScenario` 取选中详情(blurb/roles/input.default);② 运行=`api.createRun` → `api.runEvents` 订阅;③ 从 SSE 的 `step`/`status`/`result` 事件渲染(不再读 store.lines、不再 import `runScenario`/`SCENARIOS`);④ spawn/stop 改走 `api`。

- [ ] **Step 1: 全量替换 ScenarioChat.tsx**

```tsx
// src/components/ScenarioChat.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type ScenarioSummary } from "../api/client";
import type { ScenarioDef } from "../lib/orchestration/types";

function StreamingMarkdown({ text, onTick }: { text: string; onTick?: () => void }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0; const total = text.length; const step = Math.max(2, Math.ceil(total / 90));
    const t = setInterval(() => { i = Math.min(total, i + step); setShown(text.slice(0, i)); onTick?.(); if (i >= total) clearInterval(t); }, 28);
    return () => clearInterval(t);
  }, [text]);
  return (<div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{shown || ""}</ReactMarkdown>{shown.length < text.length && <span className="chat-caret" />}</div>);
}

interface StepView { stepId: string; role: string; status: string; output?: string; }

export function ScenarioChat() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [sid, setSid] = useState<string>("");
  const [detail, setDetail] = useState<ScenarioDef | null>(null);
  const [draft, setDraft] = useState("");
  const [steps, setSteps] = useState<StepView[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.listScenarios().then((s) => { setScenarios(s); if (s[0]) setSid(s[0].id); }).catch(() => setStatusMsg("无法连接后端 — 先 just server")); }, []);
  useEffect(() => { if (!sid) return; api.getScenario(sid).then((d) => { setDetail(d); setDraft(d.input.default); setSteps([]); setResult(null); setStatusMsg(""); }).catch(() => {}); }, [sid]);
  useEffect(() => () => esRef.current?.close(), []);
  const scrollToBottom = () => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { scrollToBottom(); }, [steps.length]);

  function applyStep(ev: { stepId: string; role: string; status: string; output?: string }) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.stepId === ev.stepId);
      if (i === -1) return [...prev, ev];
      const next = prev.slice(); next[i] = ev; return next;
    });
  }

  async function run() {
    if (!sid || busy || !draft.trim()) return;
    setBusy(true); setSteps([]); setResult(null); setStatusMsg("提交运行…");
    try {
      const runId = await api.createRun(sid, draft.trim());
      const es = api.runEvents(runId); esRef.current = es;
      es.addEventListener("step", (e) => applyStep(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("status", (e) => setStatusMsg(JSON.parse((e as MessageEvent).data).msg ?? ""));
      es.addEventListener("result", (e) => setResult(JSON.parse((e as MessageEvent).data).md ?? ""));
      es.addEventListener("done", () => { es.close(); esRef.current = null; setBusy(false); });
      es.addEventListener("error", () => { es.close(); esRef.current = null; setBusy(false); setStatusMsg("运行出错"); });
      es.onerror = () => { /* 连接级错误:EventSource 会重连;done 时我们已手动 close */ };
    } catch (e) { setStatusMsg("创建运行失败:" + String(e)); setBusy(false); }
  }
  async function stop() {
    if (!detail) return;
    setStatusMsg("停止本场景 agent…");
    try {
      const { sessions } = await api.agents();
      const re = new RegExp("^pi-(" + detail.roles.map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")-");
      const targets = sessions.filter((s) => re.test(s));
      await Promise.all(targets.map((s) => api.kill(s)));
      setStatusMsg(`已停止 ${targets.length} 个 agent`);
    } catch { setStatusMsg("后端未运行"); }
  }

  const roleNames = detail ? detail.roles.map((r) => r.name).join(" / ") : "";
  return (
    <aside className="rail-chat">
      <div className="chat-head">
        <select value={sid} onChange={(e) => setSid(e.target.value)}>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        {result && <button className="result-open" onClick={() => setShowResult(true)}>📄 查看完整产出</button>}
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      <div className="chat-roles">{detail?.blurb} · 角色:{roleNames}</div>
      <div className="chat-body" ref={bodyRef}>
        {steps.length === 0 && <div className="chat-empty">选择场景,填入任务并运行 → 后端按步骤分派给每个角色,各角色产出与最终装配会在这里逐条流式显示。</div>}
        {steps.map((s) => (
          s.status === "running" || s.status === "pending" ? (
            <div key={s.stepId}>
              <div className="chat-dispatch">↳ 分派给 <b>{s.role}</b></div>
              <div className="chat-msg assistant peer"><div className="chat-role">{s.role}</div><div className="chat-md chat-thinking"><span /><span /><span /></div></div>
            </div>
          ) : (
            <div key={s.stepId}>
              <div className="chat-dispatch">↳ 分派给 <b>{s.role}</b></div>
              <div className="chat-msg assistant peer"><div className="chat-role">{s.role}{s.status === "timeout" ? " · 超时" : s.status === "error" ? " · 出错" : ""}</div><StreamingMarkdown text={s.output ?? ""} onTick={scrollToBottom} /></div>
            </div>
          )
        ))}
        {statusMsg && <div className="chat-status">{statusMsg}</div>}
      </div>
      <div className="chat-composer">
        <textarea value={draft} placeholder={detail?.input.label ?? "任务…"} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
        <button className="send-btn" disabled={busy || !draft.trim()} onClick={run}>{busy ? "运行中…" : "运行编排 ⌘↵"}</button>
      </div>
      {showResult && result && (
        <div className="result-backdrop" onClick={() => setShowResult(false)}>
          <div className="result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="result-head"><strong>{detail?.title} · 完整产出</strong><span className="result-sub">后端按角色真实正文无损装配</span>
              <button className="result-copy" onClick={() => navigator.clipboard?.writeText(result)}>复制全文</button>
              <button className="result-close" onClick={() => setShowResult(false)}>✕</button></div>
            <div className="result-body"><div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div></div>
          </div>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: 验证编译 + 确认不再 import 编排/SCENARIOS**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && grep -n "runScenario\|SCENARIOS\|useStore" src/components/ScenarioChat.tsx || echo "clean"`
Expected: tsc 无输出;grep 无 `runScenario`/`SCENARIOS`/`useStore`(组件不再直接用 store 或浏览器编排)。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioChat.tsx
git commit -m "refactor(web): ScenarioChat as thin client over /api + run SSE"
```

---

### Task 10: 全链路验证 + 收尾

**Files:**
- Modify: `justfile`(确保 `spawner` 已被 `server` 取代或保留别名)
- Modify: `docs/scenarios-usage.md`(运行方式三件套→两件套 + 服务端编排说明)
- (可选)Delete: `scripts/agent-spawner.ts`(职责已迁入 `server/agents.ts`;若 justfile/文档不再引用)

- [ ] **Step 1: 全套测试 + 构建**

Run: `cd apps/coms-dashboard && bun test && bunx tsc --noEmit && bun run build`
Expected:后端 + 编排单测全绿;tsc 无输出;`vite build` 成功。

- [ ] **Step 2: 启动全链路人工验证**

```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server   # hub
just server                                            # 后端(5274)
cd apps/coms-dashboard && bun run dev                  # 前端 5273
```
在 http://localhost:5273:
1. 选「层级编排」→ 运行 → 应看到分派药丸 + 各角色产出气泡(来自后端 SSE)+ 状态 + 完成后「📄 查看完整产出」装配全文。
2. **刷新浏览器** → 重新打开后,通过历史/直接 `GET /api/runs` 能确认运行记录与产出仍在库(持久化验证)。
3. 控制台 0 报错(favicon 404 忽略)。

- [ ] **Step 3: 更新文档**

把 `docs/scenarios-usage.md` 的「准备(只需一次)」三件套改为:
```
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server   # hub
just server                                            # 后端:API + DB + 服务端编排 + spawn
cd apps/coms-dashboard && bun run dev                  # 前端
```
并补一句:编排在后端运行,运行记录与产出落 SQLite(`server/data/coms.db`),刷新/重启浏览器不丢。

- [ ] **Step 4: (可选)删除旧 spawner**

若 `grep -rn "agent-spawner\|/spawner" .` 仅剩历史文档:
```bash
git rm scripts/agent-spawner.ts
```
并删 `vite.config.ts` 里的 `/spawner` 代理项(前端已全用 `/api`)。重跑 tsc。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(B2): full-stack verification, docs, retire standalone spawner"
```

---

## Self-Review(已执行)

**Spec 覆盖:**
- B.1 服务形态(单一 Bun 服务/5274/just server/复用 A)→ Task 1 + Task 7 bootstrap;Vite `/api` → Task 1。
- B.2 数据模型(scenarios/runs/run_steps/seed/WAL/CRUD)→ Task 2。
- B.3 API(scenario CRUD + duplicate、runs POST/GET、run SSE、agents)→ Task 7。
- B.4 服务端运行引擎(hub 客户端 msg_id 关联、spawnMissing、onStep/onStatus/onResult→落库+广播)→ Task 3 + 4 + 6。
- B.5 前端迁移(client.ts、ScenarioChat 薄客户端、删浏览器编排、spawn/stop 走 api)→ Task 8 + 9;store 只读 hub 观察保留(ScenarioChat 不再 import useStore,FlowGraph/终端条仍用 store,未改)。
- B.6 错误/边界(超时/错继续、重启 abortStaleRuns、127.0.0.1、WAL)→ Task 2(abortStaleRuns)+ Task 6(error)+ Task 7(bootstrap)。
- B.7 测试(db/hubClient/runHub/runner/集成)→ Task 2/3/5/6/7。
- B.8 两阶段 → B1(1–7)/B2(8–10)。
- 完成判据(seed、后端编排、刷新存活、新建数据场景、bun test 绿)→ Task 7/9/10 覆盖。

**占位符扫描:** 无 TBD/TODO;每个代码步骤含完整代码;Task 6/7 的「runId 复用」「sseForRun 用 dbm.getRun」以明确补充说明给出确切改法(非占位)。

**类型一致性:** `ScenarioDef/RoleDef/StepStatus`(A,Task 引用一致);`RunHub.subscribe/broadcast`、`RunEvent`(Task 5)在 Task 6/7 一致;`startRun(RunnerArgs{db,hub,agents,runHub,scenario,input,runId?,onEvent?})`(Task 6,Task 7 调用一致);`buildServer(ServerDeps{db,hub,agents,awaitRuns?})`(Task 7,集成测试一致);`hub.ask(role,prompt,timeoutMs)`(Task 3)被 runner 注入一致;`api.*`(Task 8)被 ScenarioChat(Task 9)使用一致;SSE 事件 `step{stepId,role,status,output}`/`status{msg}`/`result{md}`/`done` 在 runner(发)与 ScenarioChat(收)两端字段一致。

**已知取舍(非阻断):** 集成测试用 `awaitRuns:true` 同步等待短场景;生产 `awaitRuns:false` 后台跑 + SSE 快照重放保证迟订阅也能看全。`scripts/agent-spawner.ts` 的删除放 Task 10 可选步骤,避免中途破坏引用。
