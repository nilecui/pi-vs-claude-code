# run 团队可见(子项目 F1)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 团队共享场景的运行记录对团队成员可见(含产出),历史标明 run 由谁运行;私有场景 run 仍仅 owner。

**Architecture:** 改 `server/db.ts` 的 `getRun`/`listRuns` 可见性(join scenarios.team_id + team_members)+ `RunSummary` 增 `owner_name`;前端 `RunHistory` 显示所属用户名。签名不变。

**Tech Stack:** Bun + bun:sqlite + TS;React + Vite;`bun test`。

**Spec:** `docs/superpowers/specs/2026-06-01-team-visible-runs-design.md`
**Branch:** `main`
**工作目录:** `cd apps/coms-dashboard`。

---

### Task 1: db getRun/listRuns 团队可见 + owner_name

**Files:** Modify `server/db.ts`、`server/db.test.ts`

- [ ] **Step 1: 在 db.test.ts 加失败测试**

```ts
test("run 团队可见:成员看队友对共享场景的 run,非成员不可见", () => {
  const db = freshDb();
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h"); const c = createUser(db, "carol", "h");
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob");
  upsertScenario(db, { ...demo, id: "shared" }, false, a, t); // 团队共享
  const rid = createRun(db, "shared", "i", a);                 // a 跑
  // 成员 b:listRuns 含、getRun 可见、带 owner_name
  const bRuns = listRuns(db, b, "shared");
  expect(bRuns.length).toBe(1);
  expect((bRuns[0] as { owner_name: string }).owner_name).toBe("alice");
  expect(getRun(db, rid, b)?.id).toBe(rid);
  // 非成员 c:看不到
  expect(listRuns(db, c, "shared").length).toBe(0);
  expect(getRun(db, rid, c)).toBeNull();
});

test("私有场景 run 仍仅 owner 可见(回归)", () => {
  const db = freshDb();
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h");
  upsertScenario(db, { ...demo, id: "priv" }, false, a, null); // 私有
  const rid = createRun(db, "priv", "i", a);
  expect(listRuns(db, b, "priv").length).toBe(0);
  expect(getRun(db, rid, b)).toBeNull();
  expect(getRun(db, rid, a)?.id).toBe(rid);
});
```

（顶部已 import `createUser`/`createTeam`/`addMember`(D2 测试已加);如缺,补 `import { createUser } from "./auth"; import { createTeam, addMember } from "./teams";`。)

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/db.test.ts`
Expected: FAIL（`owner_name` undefined / 非成员能看到 / getRun 越权返回非空)。

- [ ] **Step 3: 改 db.ts 的 `getRun` 与 `listRuns`**

`getRun`(替换现有):
```ts
export function getRun(db: Database, runId: string, userId: string): RunRow | null {
  const run = db.query(
    `SELECT r.*, u.username AS owner_name FROM runs r LEFT JOIN users u ON u.id = r.owner_id WHERE r.id = ?`,
  ).get(runId) as (Omit<RunRow, "steps"> & { owner_id: string | null; owner_name: string | null }) | null;
  if (!run) return null;
  const visible = run.owner_id === userId || isRunScenarioVisible(db, run.scenario_id, userId);
  if (!visible) return null;
  const steps = db.query("SELECT step_id, role, status, output FROM run_steps WHERE run_id = ? ORDER BY id").all(runId) as RunStepRow[];
  return { ...run, steps };
}

// 该 run 的场景是否对 userId 经团队可见(场景 team_id ∈ 用户所属团队)
function isRunScenarioVisible(db: Database, scenarioId: string, userId: string): boolean {
  return !!db.query(
    `SELECT 1 FROM scenarios s JOIN team_members m ON m.team_id = s.team_id
     WHERE s.id = ? AND m.user_id = ?`,
  ).get(scenarioId, userId);
}
```

`listRuns`(替换现有;加 `owner_name`,团队可见):
```ts
export function listRuns(db: Database, userId: string, scenarioId?: string): (Omit<RunRow, "steps"> & { owner_name: string | null })[] {
  const visTeam = `r.scenario_id IN (SELECT s.id FROM scenarios s JOIN team_members m ON m.team_id = s.team_id WHERE m.user_id = ?)`;
  const sel = `SELECT r.*, u.username AS owner_name FROM runs r LEFT JOIN users u ON u.id = r.owner_id`;
  if (scenarioId) {
    return db.query(`${sel} WHERE r.scenario_id = ? AND (r.owner_id = ? OR ${visTeam}) ORDER BY r.created_at DESC`)
      .all(scenarioId, userId, userId) as (Omit<RunRow, "steps"> & { owner_name: string | null })[];
  }
  return db.query(`${sel} WHERE r.owner_id = ? OR ${visTeam} ORDER BY r.created_at DESC`)
    .all(userId, userId) as (Omit<RunRow, "steps"> & { owner_name: string | null })[];
}
```

> `RunRow` 接口可选地加 `owner_name`,但 listRuns/getRun 已用结构化返回;为类型整洁,在 `db.ts` 顶部给 `RunRow` 之外不强加。前端用自己的 `RunSummary`(Task 3)声明 `owner_name`。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/db.test.ts`
Expected: PASS（含 2 新测试 + 既有 owner 测试不回归 —— 私有/owner 语义保持)。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/server/db.ts apps/coms-dashboard/server/db.test.ts
git commit -m "feat(server): team-visible runs (run follows scenario visibility) + owner_name"
```

---

### Task 2: 集成测试(A、B 同队,B 看得到 A 的共享场景 run)

**Files:** Modify `server/server.integration.test.ts`

- [ ] **Step 1: 加测试(放在末尾,复用既有 register/call 助手)**

```ts
test("run 团队可见:同队成员看得到队友对共享场景的 run", async () => {
  const { handler } = harness();
  const a = await register(handler, "ra", "p");
  const b = await register(handler, "rb", "p");
  const c = await register(handler, "rc", "p");
  const { id: teamId } = await (await call(handler, "POST", "/api/teams", a, { name: "dev" })).json();
  await call(handler, "POST", `/api/teams/${teamId}/members`, a, { username: "rb" });
  const scn = { id: "rshare", title: "X", blurb: "b", roles: [{ name: "r", provider: "x", model: "x", purpose: "", color: "#000" }], input: { label: "l", default: "d" }, steps: [{ id: "s1", role: "r", prompt: "{{input}}", after: [] }], assembly: "R:{{steps.s1}}", teamId };
  await call(handler, "POST", "/api/scenarios", a, scn);
  const { runId } = await (await call(handler, "POST", "/api/runs", a, { scenarioId: "rshare", input: "X" })).json();
  // b 成员可见,owner_name=ra
  const bRuns = await (await call(handler, "GET", "/api/runs?scenarioId=rshare", b)).json();
  expect(bRuns.runs.length).toBe(1);
  expect(bRuns.runs[0].owner_name).toBe("ra");
  expect((await call(handler, "GET", `/api/runs/${runId}`, b)).status).toBe(200);
  // c 非成员不可见
  expect((await (await call(handler, "GET", "/api/runs?scenarioId=rshare", c)).json()).runs.length).toBe(0);
  expect((await call(handler, "GET", `/api/runs/${runId}`, c)).status).toBe(404);
});
```

- [ ] **Step 2: 跑后端全套 + tsc**

Run: `cd apps/coms-dashboard && bun test server/ && bunx tsc --noEmit`
Expected: 全绿,tsc 无输出。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/server/server.integration.test.ts
git commit -m "test(server): integration — team-visible runs for shared scenario"
```

---

### Task 3: 前端 RunHistory 显示 run 所属用户名

**Files:** Modify `src/api/client.ts`、`src/components/RunHistory.tsx`

- [ ] **Step 1: client.ts —— RunSummary 加 owner_name**

把 `RunSummary` 接口改为:
```ts
export interface RunSummary { id: string; scenario_id: string; input: string; status: string; result_md: string | null; created_at: number; finished_at: number | null; owner_name: string | null; }
```

- [ ] **Step 2: RunHistory.tsx —— 列表项显示「由 {owner_name}」**

把列表项里时间那行改为(在 `history-time` 之前插入所属):
```tsx
                <div className="history-item-top">
                  <span className={`history-badge st-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  {r.owner_name && <span className="history-owner">由 {r.owner_name}</span>}
                  <span className="history-time">{fmtTime(r.created_at)}</span>
                </div>
```
（`RunSummary` 已从 `../api/client` import;`owner_name` 现在类型上存在。)

- [ ] **Step 3: 样式(追加 styles.css)**

```css
.history-owner { font-size: 10px; color: var(--muted); border: 1px solid var(--hairline-soft); border-radius: 999px; padding: 0 6px; }
```

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && bun test && bun run build`
Expected: tsc 无输出;`bun test` 全绿(81 + F1 db 2 + 集成 1 = 84);build 成功。
```bash
git add apps/coms-dashboard/src/api/client.ts apps/coms-dashboard/src/components/RunHistory.tsx apps/coms-dashboard/src/styles.css
git commit -m "feat(web): show run owner in history (team-visible runs)"
```

---

### Task 4: 浏览器人工验收(可选,实跑)

- [ ] **Step 1:** 起 hub + server + dev;alice 建团队加 bob、把场景设团队可见、运行一次;登出以 bob 登录 → 打开该场景「历史」→ 看到 alice 的 run(标「由 alice」)+ 可重看产出;以非成员 carol 登录 → 看不到。

---

## Self-Review(已执行)

- **Spec 覆盖:** 可见性规则(run 跟场景)→ Task 1(getRun/listRuns + isRunScenarioVisible);owner_name → Task 1(SQL join)+ Task 3(类型/UI);测试(db + 集成)→ Task 1/2;前端显示所属 → Task 3;完成判据 → Task 2/3/4。
- **占位符扫描:** 无 TBD;给出完整 SQL/代码/测试。
- **类型一致性:** `getRun(db,runId,userId)`/`listRuns(db,userId,scenarioId?)` 签名不变(仅行多 `owner_name`);`isRunScenarioVisible` 私有 helper;前端 `RunSummary.owner_name`(Task 3)与后端返回字段一致;`RunHistory` 已 import `RunSummary`,`r.owner_name` 可用。集成测试复用 D1/D2 已加的 `register`/`call` 助手。
- **已知取舍:** `RunRow` 接口不强加 `owner_name`(listRuns/getRun 返回结构化对象,前端按 `RunSummary` 取);旧无主 run owner_name 为 null,UI 不显示「由」。
