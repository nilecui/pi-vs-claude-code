# 账号 + 归属隔离(子项目 D1)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 加用户账号(密码+session cookie)、`/api` 鉴权中间件、scenarios/runs 按 owner 隔离、登录 UI;未登录不能用面板。

**Architecture:** `server/auth.ts`(Bun.password + session,纯部分可测)+ `buildServer` 鉴权中间件 + `db.ts` 加 users/sessions 表与 `owner_id` 维度 + 前端 `Login` 与 `App` 的 `me()` 门禁。D2(团队/共享)下一轮。

**Tech Stack:** Bun(`Bun.password`、`bun:sqlite`)+ TS;React18 + Zustand + Vite;`bun test`。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-accounts-ownership-design.md`
**Branch:** `coms-dashboard-terminals`
**工作目录:** `cd apps/coms-dashboard`;后端测试 `bun test server/`。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `server/auth.ts` | new | 密码哈希、会话、用户 CRUD |
| `server/auth.test.ts` | new | auth 单测 |
| `server/db.ts` | modify | users/sessions 表 + owner_id 迁移 + owner-aware 函数 |
| `server/db.test.ts` | modify | 更新签名 + owner 过滤测试 |
| `server/runner.ts` | modify | `startRun` 加 `ownerId` |
| `server/runner.test.ts` | modify | 传 ownerId |
| `server/index.ts` | modify | /api/auth/* 路由 + 鉴权中间件 + 线程 userId + hostname 环境变量 |
| `server/server.integration.test.ts` | modify | 先注册/登录拿 cookie 再调 /api |
| `src/api/client.ts` | modify | `credentials:"include"` + `auth.*` |
| `src/components/Login.tsx` | new | 登录/注册页 |
| `src/App.tsx` | modify | `me()` 门禁 + 当前用户/登出(拆出 `Dashboard`) |

---

# 阶段:后端(Task 1–4)

### Task 1: 鉴权层 `server/auth.ts`

**Files:** Create `server/auth.ts`, `server/auth.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// server/auth.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "./db";
import { hashPassword, verifyPassword, createUser, getUserByName, createSession, getSessionUser, deleteSession } from "./auth";

function db() { const d = new Database(":memory:"); migrate(d); return d; }

test("hash/verify 往返", async () => {
  const h = await hashPassword("s3cret");
  expect(await verifyPassword("s3cret", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});

test("createUser + getUserByName;重名抛错", async () => {
  const d = db();
  const id = await (async () => createUser(d, "alice", await hashPassword("p")))();
  expect(typeof id).toBe("string");
  expect(getUserByName(d, "alice")?.username).toBe("alice");
  expect(() => createUser(d, "alice", "x")).toThrow();
});

test("session 创建/取回/删除", async () => {
  const d = db();
  const uid = createUser(d, "bob", await hashPassword("p"));
  const tok = createSession(d, uid);
  expect(getSessionUser(d, tok)?.username).toBe("bob");
  deleteSession(d, tok);
  expect(getSessionUser(d, tok)).toBeNull();
});

test("过期 session → null", async () => {
  const d = db();
  const uid = createUser(d, "carol", await hashPassword("p"));
  const tok = createSession(d, uid, -1000); // 已过期
  expect(getSessionUser(d, tok)).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`(且 `migrate` 尚未建 users/sessions 表 → Task 2 会补;本任务先让 auth.ts 存在并用到的表在 Task 2 建。**先做 Task 2 的建表再回来跑**,或本步骤接受失败直到 Task 2)。

> 执行顺序提示:Task 1 与 Task 2 互有依赖(auth 用 users/sessions 表;db.test 用 auth 无关)。**先写 Task 2 的建表 DDL,再跑 Task 1 测试**。下面 Task 2 已包含建表。

- [ ] **Step 3: 写实现**

```ts
// server/auth.ts
import type { Database } from "bun:sqlite";

export async function hashPassword(pw: string): Promise<string> { return Bun.password.hash(pw); }
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try { return await Bun.password.verify(pw, hash); } catch { return false; }
}

export interface UserRow { id: string; username: string; }

export function createUser(db: Database, username: string, passwordHash: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    [id, username, passwordHash, Date.now()]); // UNIQUE(username) 冲突会抛
  return id;
}
export function getUserByName(db: Database, username: string): { id: string; username: string; password_hash: string } | null {
  return db.query("SELECT id, username, password_hash FROM users WHERE username = ?").get(username) as any ?? null;
}

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export function createSession(db: Database, userId: string, ttlMs: number = SESSION_TTL): string {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  db.run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, userId, now, now + ttlMs]);
  return token;
}
export function getSessionUser(db: Database, token: string | null | undefined): UserRow | null {
  if (!token) return null;
  const row = db.query(
    `SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token) as any;
  if (!row) return null;
  if (row.expires_at < Date.now()) { deleteSession(db, token); return null; }
  return { id: row.id, username: row.username };
}
export function deleteSession(db: Database, token: string): void {
  db.run("DELETE FROM sessions WHERE token = ?", [token]);
}
```

- [ ] **Step 4: (Task 2 建表后)运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/auth.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**(可与 Task 2 一起提交,因表依赖)

```bash
git add apps/coms-dashboard/server/auth.ts apps/coms-dashboard/server/auth.test.ts
git commit -m "feat(server): auth — password hash + sessions + users"
```

---

### Task 2: db 加 users/sessions 表 + owner_id 迁移 + owner-aware 函数

**Files:** Modify `server/db.ts`、`server/db.test.ts`

- [ ] **Step 1: `migrate` 末尾追加建表 + owner_id 迁移**

在 `db.ts` 的 `migrate(db)` 函数内、现有建表之后追加:

```ts
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  for (const t of ["scenarios", "runs"]) {
    const cols = db.query(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "owner_id")) db.run(`ALTER TABLE ${t} ADD COLUMN owner_id TEXT`);
  }
```

- [ ] **Step 2: 改 owner-aware 函数签名(替换 db.ts 中对应函数)**

```ts
export function listScenarios(db: Database, userId: string): ScenarioRow[] {
  return db.query(
    "SELECT id, title, blurb, builtin FROM scenarios WHERE owner_id = ? OR owner_id IS NULL ORDER BY builtin DESC, title"
  ).all(userId) as ScenarioRow[];
}

export function getScenario(db: Database, id: string | undefined, userId: string): ScenarioDef | null {
  if (!id) return null;
  const row = db.query("SELECT data, owner_id FROM scenarios WHERE id = ?").get(id) as { data: string; owner_id: string | null } | null;
  if (!row) return null;
  if (row.owner_id !== null && row.owner_id !== userId) return null; // 越权当不存在
  return JSON.parse(row.data) as ScenarioDef;
}

export function upsertScenario(db: Database, s: ScenarioDef, builtin: boolean, ownerId: string | null): void {
  const now = Date.now();
  db.run(
    `INSERT INTO scenarios (id, title, blurb, data, builtin, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, blurb=excluded.blurb,
       data=excluded.data, owner_id=excluded.owner_id, updated_at=excluded.updated_at`,
    [s.id, s.title, s.blurb, JSON.stringify(s), builtin ? 1 : 0, ownerId, now, now],
  );
}

export function createRun(db: Database, scenarioId: string, input: string, ownerId: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO runs (id, scenario_id, input, status, owner_id, created_at) VALUES (?, ?, ?, 'running', ?, ?)",
    [id, scenarioId, input, ownerId, Date.now()]);
  return id;
}

export function getRun(db: Database, runId: string, userId: string): RunRow | null {
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(runId) as (Omit<RunRow, "steps"> & { owner_id: string | null }) | null;
  if (!run) return null;
  if (run.owner_id !== null && run.owner_id !== userId) return null;
  const steps = db.query("SELECT step_id, role, status, output FROM run_steps WHERE run_id = ? ORDER BY id").all(runId) as RunStepRow[];
  return { ...run, steps };
}

export function listRuns(db: Database, userId: string, scenarioId?: string): Omit<RunRow, "steps">[] {
  if (scenarioId) {
    return db.query("SELECT * FROM runs WHERE owner_id = ? AND scenario_id = ? ORDER BY created_at DESC").all(userId, scenarioId) as Omit<RunRow, "steps">[];
  }
  return db.query("SELECT * FROM runs WHERE owner_id = ? ORDER BY created_at DESC").all(userId) as Omit<RunRow, "steps">[];
}
```

`seedScenarios` 调用改为 `upsertScenario(db, s, true, null)`(内置 owner=null)。`isBuiltin`、`updateRunStatus`、`upsertRunStep`、`deleteScenario`、`abortStaleRuns` 签名不变(后两者由路由层先校验归属)。

- [ ] **Step 3: 更新 `db.test.ts`(传 userId/ownerId)+ 加 owner 过滤测试**

把现有 3 个测试里的调用改为带 owner 维度(示例):`upsertScenario(db, demo, false, "u1")`;`getScenario(db, "x", "u1")`;`createRun(db, "x", "input-text", "u1")`;`listScenarios(db, "u1")`;`getRun(db, runId, "u1")`;`listRuns(db, "u1", "x")`。并新增:

```ts
test("owner 隔离:listScenarios 只见本人 + 内置(NULL)", () => {
  const d = freshDb();
  upsertScenario(d, { ...demo, id: "mine" }, false, "u1");
  upsertScenario(d, { ...demo, id: "theirs" }, false, "u2");
  upsertScenario(d, { ...demo, id: "builtin" }, true, null);
  const ids = listScenarios(d, "u1").map((s) => s.id).sort();
  expect(ids).toEqual(["builtin", "mine"]);
});
test("越权 getScenario/getRun 返回 null", () => {
  const d = freshDb();
  upsertScenario(d, { ...demo, id: "mine" }, false, "u1");
  expect(getScenario(d, "mine", "u2")).toBeNull();
  const rid = createRun(d, "mine", "i", "u1");
  expect(getRun(d, rid, "u2")).toBeNull();
  expect(getRun(d, rid, "u1")?.id).toBe(rid);
});
test("listRuns 按 owner 过滤", () => {
  const d = freshDb();
  upsertScenario(d, demo, false, "u1");
  createRun(d, "x", "a", "u1"); createRun(d, "x", "b", "u2");
  expect(listRuns(d, "u1").length).toBe(1);
  expect(listRuns(d, "u2").length).toBe(1);
});
```

(原有断言中 `getScenario(db)?.id` 这类无 id 调用改为 `getScenario(db, undefined, "u1")`。)

- [ ] **Step 4: 跑 db + auth 测试**

Run: `cd apps/coms-dashboard && bun test server/db.test.ts server/auth.test.ts`
Expected: PASS（db 6 + auth 4）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/server/db.ts apps/coms-dashboard/server/db.test.ts apps/coms-dashboard/server/auth.ts apps/coms-dashboard/server/auth.test.ts
git commit -m "feat(server): users/sessions tables + owner_id isolation in db layer"
```

---

### Task 3: runner 加 ownerId

**Files:** Modify `server/runner.ts`、`server/runner.test.ts`

- [ ] **Step 1: 改 `RunnerArgs` + `startRun`**

`RunnerArgs` 加 `ownerId: string;`。`startRun` 内 `createRun` 调用改为 `createRun(db, scenario.id, input, args.ownerId)`(仅当未传 `runId` 时创建;若传入 `runId` 则已由路由 createRun 带 owner)。即:
```ts
  const runId = args.runId ?? createRun(db, scenario.id, input, args.ownerId);
```

- [ ] **Step 2: 更新 `runner.test.ts`**

`startRun({ ..., ownerId: "u1" })` 给两处调用加 `ownerId: "u1"`。

- [ ] **Step 3: 跑 runner 测试**

Run: `cd apps/coms-dashboard && bun test server/runner.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 4: Commit**

```bash
git add apps/coms-dashboard/server/runner.ts apps/coms-dashboard/server/runner.test.ts
git commit -m "feat(server): thread ownerId through startRun"
```

---

### Task 4: index.ts — auth 路由 + 中间件 + 线程 userId + hostname + 集成测试

**Files:** Modify `server/index.ts`、`server/server.integration.test.ts`

- [ ] **Step 1: import auth + cookie 帮助函数**

`index.ts` 顶部 import 追加:
```ts
import { hashPassword, verifyPassword, createUser, getUserByName, createSession, getSessionUser, deleteSession } from "./auth";
```
在 `json()` 附近加:
```ts
function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return decodeURIComponent(v.join("=")); }
  return null;
}
function sessionCookie(token: string, maxAgeSec = 7 * 24 * 3600): string {
  return `coms_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}
function jsonCookie(data: unknown, cookie: string, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(), "Set-Cookie": cookie } });
}
```

- [ ] **Step 2: 在 `buildServer` 的 handler 内,OPTIONS 之后、`/api/health` 之前插入 auth 路由 + 中间件**

```ts
      // ---- auth(免鉴权)----
      if (req.method === "POST" && p === "/api/auth/register") {
        const { username, password } = (await req.json()) as { username: string; password: string };
        if (!username?.trim() || !password || password.length < 1) return json({ error: "用户名/密码不能为空" }, 400);
        if (getUserByName(deps.db, username)) return json({ error: "用户名已被占用" }, 409);
        const uid = createUser(deps.db, username, await hashPassword(password));
        const token = createSession(deps.db, uid);
        return jsonCookie({ user: { id: uid, username } }, sessionCookie(token));
      }
      if (req.method === "POST" && p === "/api/auth/login") {
        const { username, password } = (await req.json()) as { username: string; password: string };
        const u = getUserByName(deps.db, username ?? "");
        if (!u || !(await verifyPassword(password ?? "", u.password_hash))) return json({ error: "用户名或密码错误" }, 401);
        const token = createSession(deps.db, u.id);
        return jsonCookie({ user: { id: u.id, username: u.username } }, sessionCookie(token));
      }
      if (req.method === "POST" && p === "/api/auth/logout") {
        const tok = parseCookie(req, "coms_session");
        if (tok) deleteSession(deps.db, tok);
        return jsonCookie({ ok: true }, "coms_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      }
      if (req.method === "GET" && p === "/api/health") return json({ ok: true, port: PORT });

      // ---- 鉴权中间件:其余 /api/* 需有效 session ----
      const user = getSessionUser(deps.db, parseCookie(req, "coms_session"));
      if (p === "/api/auth/me") return user ? json({ user }) : json({ error: "unauthorized" }, 401);
      if (p.startsWith("/api/") && !user) return json({ error: "unauthorized" }, 401);
      const uid = user!.id; // 下面 /api/* 处理用 uid
```

- [ ] **Step 3: 把后续 db 调用改为带 uid**

在 Step 2 之后的既有路由里:
- `dbm.listScenarios(deps.db)` → `dbm.listScenarios(deps.db, uid)`
- `dbm.getScenario(deps.db, id)` → `dbm.getScenario(deps.db, id, uid)`(两处:GET 详情、duplicate 源、PUT/DELETE 前的 isBuiltin 仍用 id;runs 的 scenario 取用 `getScenario(deps.db, scenarioId, uid)`)
- `dbm.upsertScenario(deps.db, body, false)` → `dbm.upsertScenario(deps.db, body, false, uid)`(POST 与 PUT)
- duplicate:复制后 `dbm.upsertScenario(deps.db, copy, false, uid)`
- `dbm.createRun(deps.db, scenarioId, input)` → `dbm.createRun(deps.db, scenarioId, input, uid)`;后台 `startRun({..., ownerId: uid})`;awaitRuns 分支同理传 `ownerId: uid`
- `dbm.listRuns(deps.db, sid)` → `dbm.listRuns(deps.db, uid, sid)`
- `dbm.getRun(deps.db, runId)` → `dbm.getRun(deps.db, runId, uid)`
- SSE `sseForRun(runId)`:快照用 `dbm.getRun(deps.db, runId, uid)`(把 uid 传入 `sseForRun`)。
- PUT/DELETE 内置判断后,补一道归属校验:取 `dbm.getScenario(deps.db, id, uid)` 为 null → 404(防改他人)。

- [ ] **Step 4: bootstrap hostname + startRun ownerId**

生产 bootstrap 的 `Bun.serve({ ... hostname: ... })` 改:
```ts
  const HOST = process.env.COMS_SERVER_HOST ?? "127.0.0.1";
  Bun.serve({ port: PORT, hostname: HOST, idleTimeout: 255, fetch: handler });
  console.log(`[coms-server] listening on http://${HOST}:${PORT}`);
```
(后台 `runExisting`/`startRun` 调用已在 Step 3 带 `ownerId: uid`。)

- [ ] **Step 5: 更新集成测试(先登录拿 cookie)**

`server.integration.test.ts`:`harness()` 不变(`awaitRuns:true`)。新增登录助手并改测试:
```ts
async function authed(handler: (r: Request) => Promise<Response>) {
  const res = await handler(new Request("http://t/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "u1", password: "p1" }) }));
  const cookie = res.headers.get("set-cookie")!.split(";")[0]; // coms_session=...
  return cookie;
}
async function call(handler: any, method: string, path: string, cookie?: string, body?: unknown) {
  return handler(new Request("http://t" + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
}
```
改测试:`GET /api/scenarios` 无 cookie → 期望 401;带 cookie → 200 且含 demo;`POST /api/runs` 带 cookie → done + result;`PUT /api/scenarios/demo` 带 cookie → 409(内置);新增「`/api/health` 无 cookie 200」「`/api/auth/me` 无 cookie 401、注册后 200」。

- [ ] **Step 6: 跑后端全套 + tsc**

Run: `cd apps/coms-dashboard && bun test server/ && bunx tsc --noEmit`
Expected: 全绿(auth 4 + db 6 + hubClient 3 + runHub 2 + runner 2 + 集成 ~5),tsc 无输出。

- [ ] **Step 7: Commit**

```bash
git add apps/coms-dashboard/server/index.ts apps/coms-dashboard/server/server.integration.test.ts
git commit -m "feat(server): auth routes + session middleware + owner-scoped /api + COMS_SERVER_HOST"
```

---

# 阶段:前端(Task 5–6)

### Task 5: client 鉴权 + Login + App 门禁

**Files:** Modify `src/api/client.ts`、`src/App.tsx`;Create `src/components/Login.tsx`;Modify `src/styles.css`

- [ ] **Step 1: client.ts —— 带 cookie + auth API**

把 `j()` 的 `fetch` 加 `credentials: "include"`:
```ts
async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}
```
在 `export const api = {` 之前加:
```ts
export interface AuthUser { id: string; username: string; }
export const auth = {
  me: () => j<{ user: AuthUser }>("/api/auth/me").then((r) => r.user),
  login: (username: string, password: string) => j<{ user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }).then((r) => r.user),
  register: (username: string, password: string) => j<{ user: AuthUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }).then((r) => r.user),
  logout: () => j("/api/auth/logout", { method: "POST" }),
};
```

- [ ] **Step 2: Login.tsx**

```tsx
// src/components/Login.tsx
import { useState } from "react";
import { auth, type AuthUser } from "../api/client";

export function Login({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!username || !password || busy) return;
    setBusy(true); setErr("");
    try {
      const u = mode === "login" ? await auth.login(username, password) : await auth.register(username, password);
      onAuthed(u);
    } catch (e) {
      const m = String(e); const jm = m.match(/\{[\s\S]*\}/);
      try { setErr((jm ? JSON.parse(jm[0]) : null)?.error ?? "操作失败"); } catch { setErr("操作失败"); }
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-title">coms-net 控制面板</div>
        <div className="login-sub">{mode === "login" ? "登录以继续" : "注册新账号"}</div>
        <input placeholder="用户名" value={username} onChange={(e) => setU(e.target.value)} />
        <input type="password" placeholder="密码" value={password} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        {err && <div className="login-err">{err}</div>}
        <button className="login-go" disabled={busy || !username || !password} onClick={submit}>{busy ? "…" : mode === "login" ? "登录" : "注册"}</button>
        <button className="login-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
          {mode === "login" ? "没有账号?去注册" : "已有账号?去登录"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: App.tsx —— 门禁(拆出 Dashboard)**

整体替换 `src/App.tsx`:
```tsx
import { useEffect, useState } from "react";
import { AddAgentForm } from "./components/AddAgentForm";
import { AgentList } from "./components/AgentList";
import { FlowGraph } from "./components/FlowGraph";
import { NodePanel } from "./components/NodePanel";
import { TerminalStrip } from "./components/TerminalStrip";
import { ScenarioChat } from "./components/ScenarioChat";
import { Broadcast } from "./components/Broadcast";
import { Login } from "./components/Login";
import { useStore } from "./store";
import { CONN_STATUS_LABEL } from "./lib/labels";
import { api, type AuthUser } from "./api/client";

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => { api.auth.me().then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="login-screen"><div className="login-card"><div className="login-sub">加载中…</div></div></div>;
  if (!user) return <Login onAuthed={setUser} />;
  return <Dashboard user={user} onLogout={async () => { await api.auth.logout().catch(() => {}); setUser(null); }} />;
}

function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const init = useStore((s) => s.init);
  const shutdown = useStore((s) => s.shutdown);
  const status = useStore((s) => s.status);
  useEffect(() => { init(); return () => shutdown(); }, [init, shutdown]);

  return (
    <div className="app">
      <TerminalStrip />
      <div className="app-body">
        <aside className="rail-left">
          <div className="brand">
            <div className="brand-logo">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
              </svg>
            </div>
            <div className="brand-text">
              <div className="brand-title">coms-net 控制面板</div>
              <div className="brand-status"><span className={`status-led led-${status}`} /><span className="brand-sub">{CONN_STATUS_LABEL[status] ?? status}</span></div>
            </div>
            <button className="brand-logout" onClick={onLogout} title={`登出 ${user.username}`}>{user.username} · 登出</button>
          </div>
          <AddAgentForm />
          <Broadcast />
          <AgentList />
        </aside>
        <main className="rail-center">
          <FlowGraph />
          <NodePanel />
        </main>
        <ScenarioChat />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 样式(追加 `src/styles.css` 末尾)**

```css
/* auth (sub-project D1) */
.login-screen { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); }
.login-card { width: 320px; display: flex; flex-direction: column; gap: 10px; padding: 28px 24px; border: 1px solid var(--hairline); border-radius: 16px; box-shadow: var(--shadow-hover); background: var(--card); }
.login-title { font-size: 18px; font-weight: 700; color: var(--text); }
.login-sub { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.login-card input { font: inherit; font-size: 14px; padding: 9px 11px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--bg); color: var(--text); }
.login-card input:focus { outline: none; border-color: var(--primary); }
.login-err { font-size: 12px; color: #b91c1c; }
.login-go { font: inherit; font-size: 14px; padding: 9px; border: 0; border-radius: 9px; background: var(--primary); color: #fff; cursor: pointer; }
.login-go:disabled { opacity: .5; cursor: not-allowed; }
.login-switch { border: 0; background: none; color: var(--primary-strong); font-size: 12px; cursor: pointer; }
.brand-logout { margin-left: auto; border: 1px solid var(--hairline); background: var(--card); color: var(--muted); border-radius: 8px; padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.brand-logout:hover { color: var(--text); border-color: var(--primary); }
```

- [ ] **Step 5: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/src/api/client.ts apps/coms-dashboard/src/components/Login.tsx apps/coms-dashboard/src/App.tsx apps/coms-dashboard/src/styles.css
git commit -m "feat(web): login gate + auth client + current-user/logout"
```

---

### Task 6: 全套验证 + 浏览器人工验收

- [ ] **Step 1: tsc + 全套测试 + build**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && bun test && bun run build`
Expected: tsc 无输出;`bun test` 全绿(现有 61 + auth 4 + db owner 3 + 集成新增 ≈ 69+);build 成功。

- [ ] **Step 2: 启动并人工验收(需删旧 db 或新库以应用迁移)**

> 迁移幂等会给现有 `coms.db` 加 users/sessions/owner_id;旧 scenarios 的 owner_id=NULL(内置仍共享)。直接启动即可。

```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server
just server
cd apps/coms-dashboard && bun run dev
```
http://localhost:5273:
1. 首次打开 → **登录页**;点「去注册」用 alice/pw 注册 → 进入面板,左上显示「alice · 登出」。
2. 新建一个场景并运行 → 历史里有记录。
3. **登出** → 回登录页;注册第二个用户 bob → 进入面板:bob **看不到 alice 的自定义场景与运行**,但能看到 3 个内置场景(只读,可复制并编辑)。
4. 浏览器开发者工具直接 `fetch('/api/scenarios')` 不带 cookie(或无痕)→ 401。
5. 控制台 0 报错(favicon 忽略)。

- [ ] **Step 3: Commit(收尾,可空)**

```bash
git commit --allow-empty -m "chore(D1): accounts + ownership verified end-to-end"
```

---

## Self-Review(已执行)

- **Spec 覆盖:** D1.1 表/迁移→Task 2;D1.2 auth.ts→Task 1;D1.3 路由+中间件→Task 4;D1.4 db owner 隔离→Task 2(+ Task 4 线程 uid、Task 3 runner ownerId);D1.5 前端(client/Login/App/登出)→Task 5;D1.6 hostname→Task 4 Step 4;D1.8 错误(409/401/越权404/过期)→Task 4;D1.9 测试(auth/db owner/集成 login-first + 现有测试更新)→Task 1/2/3/4;完成判据→Task 6。
- **占位符扫描:** 无 TBD;给出完整代码(auth.ts、db 函数、中间件代码块、Login、App、CSS、各测试)。Task 4 Step 3 为「逐调用点改带 uid」的精确清单(列出每个 db 调用的新签名),非占位。
- **类型一致性:** `getSessionUser/createSession/...`(Task1)与 index 中间件(Task4)一致;db 函数新签名 `listScenarios(db,userId)`/`getScenario(db,id,userId)`/`upsertScenario(db,s,builtin,ownerId)`/`createRun(db,scenarioId,input,ownerId)`/`getRun(db,id,userId)`/`listRuns(db,userId,scenarioId?)`(Task2)在 Task4 调用点、db.test(Task2)、runner(Task3,createRun)一致;`startRun` 加 `ownerId`(Task3)与 index 调用(Task4)一致;`auth`/`AuthUser`(Task5 client)与 Login/App 使用一致;集成测试登录助手(Task4 Step5)用 register 的 Set-Cookie。
- **执行顺序提示:** Task 1 的测试依赖 Task 2 的建表 —— 实现时先落 Task 2 的 `migrate` 建表 DDL,再跑 Task 1 测试(或两者合并提交)。
- **已知取舍:** 旧无主 runs(owner_id NULL)在 `listRuns` 中不显示(按 owner 过滤),符合「不泄露」;旧无主自定义场景(NULL)被视为公共只读(与内置同语义)——本期可接受,真实环境此前数据多为测试残留。前端组件无单测,靠 tsc + 浏览器;纯逻辑(auth/db)已单测。
