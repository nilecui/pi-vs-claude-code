# 团队 + 场景共享(子项目 D2)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用户建/加入团队;场景可见性 = 私有 或 共享给某团队(成员只读可复制);owner 管成员。run 仍各人私有。

**Architecture:** 新表 `teams`/`team_members` + `scenarios.team_id`;`server/teams.ts`(团队逻辑,纯可测)+ db 可见性查询扩展(子查询 team_members)+ 团队 REST API + 前端团队模态与编辑器可见性下拉。

**Tech Stack:** Bun + bun:sqlite + TS;React18 + Vite;`bun test`。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-teams-sharing-design.md`
**Branch:** `coms-dashboard-terminals`（A/B/C/E/D1 已完成）
**工作目录:** `cd apps/coms-dashboard`。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `server/teams.ts` | new | 团队 CRUD + 成员管理(纯 db 逻辑) |
| `server/teams.test.ts` | new | 团队单测 |
| `server/db.ts` | modify | migrate 加 teams/team_members 表 + scenarios.team_id;可见性查询含团队;`isScenarioOwner`;`upsertScenario` 加 teamId |
| `server/db.test.ts` | modify | upsert 调用加 teamId 参数 + 团队可见性测试 |
| `server/index.ts` | modify | 团队路由 + scenarios 接受 teamId + GET/:id 返回 {scenario,teamId} + PUT/DELETE 用 isScenarioOwner |
| `server/server.integration.test.ts` | modify | 团队共享集成 |
| `src/api/client.ts` | modify | `teams.*` + create/updateScenario 加 teamId + getScenario 返回 teamId |
| `src/components/Teams.tsx` | new | 团队管理模态 |
| `src/components/ScenarioChat.tsx` | modify | 「团队」入口 |
| `src/components/ScenarioEditor.tsx` | modify | 可见性下拉 |
| `src/styles.css` | modify | `.teams-*` |

> `db.ts` 的可见性查询用**子查询** `team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)`,不依赖 `teams.ts`(避免循环依赖);`teams.ts` 与 `db.ts` 共用 team_members 表。

---

# 阶段:后端(Task 1–3)

### Task 1: db migrate 建表 + `server/teams.ts`

**Files:** Modify `server/db.ts`(migrate);Create `server/teams.ts`、`server/teams.test.ts`

- [ ] **Step 1: db.ts `migrate` 末尾追加(users/sessions 之后)**

```ts
  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id))`);
  {
    const cols = db.query(`PRAGMA table_info(scenarios)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "team_id")) db.run(`ALTER TABLE scenarios ADD COLUMN team_id TEXT`);
  }
```

- [ ] **Step 2: 写失败测试 `server/teams.test.ts`**

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "./db";
import { createUser } from "./auth";
import { createTeam, listTeams, getTeam, addMember, removeMember, deleteTeam, isTeamMember, userTeamIds } from "./teams";

async function setup() {
  const db = new Database(":memory:"); migrate(db);
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h"); const c = createUser(db, "carol", "h");
  return { db, a, b, c };
}

test("createTeam:创建者成为 owner 成员", async () => {
  const { db, a } = await setup();
  const t = createTeam(db, "dev", a);
  expect(isTeamMember(db, t, a)).toBe(true);
  expect(listTeams(db, a).map((x) => x.role)).toEqual(["owner"]);
  expect(userTeamIds(db, a)).toEqual([t]);
});

test("addMember:owner 加 / 非 owner 拒 / 无用户 / 重复", async () => {
  const { db, a, b } = await setup();
  const t = createTeam(db, "dev", a);
  expect(addMember(db, t, b, "bob")).toBe("not_owner");
  expect(addMember(db, t, a, "nobody")).toBe("no_user");
  expect(addMember(db, t, a, "bob")).toBe("ok");
  expect(addMember(db, t, a, "bob")).toBe("exists");
  expect(isTeamMember(db, t, b)).toBe(true);
});

test("getTeam:成员可见(含成员列表),非成员 null", async () => {
  const { db, a, b, c } = await setup();
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob");
  const got = getTeam(db, t, b);
  expect(got?.members.map((m) => m.username).sort()).toEqual(["alice", "bob"]);
  expect(getTeam(db, t, c)).toBeNull();
});

test("removeMember:成员离开 / owner 移除 / 越权拒", async () => {
  const { db, a, b, c } = await setup();
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob"); addMember(db, t, a, "carol");
  expect(removeMember(db, t, b, b)).toBe("ok");          // bob 离开
  expect(isTeamMember(db, t, b)).toBe(false);
  expect(removeMember(db, t, c, a)).toBe("forbidden");   // carol 不能移除别人
  expect(removeMember(db, t, a, c)).toBe("ok");          // owner 移除 carol
});

test("deleteTeam:仅 owner;共享场景 team_id 回退 NULL", async () => {
  const { db, a, b } = await setup();
  const t = createTeam(db, "dev", a);
  db.run("INSERT INTO scenarios (id,title,blurb,data,builtin,owner_id,team_id,created_at,updated_at) VALUES ('s','t','b','{}',0,?,?,0,0)", [a, t]);
  expect(deleteTeam(db, t, b)).toBe("forbidden");
  expect(deleteTeam(db, t, a)).toBe("ok");
  const row = db.query("SELECT team_id FROM scenarios WHERE id='s'").get() as { team_id: string | null };
  expect(row.team_id).toBeNull();
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test server/teams.test.ts`
Expected: FAIL — `Cannot find module './teams'`。

- [ ] **Step 4: 写 `server/teams.ts`**

```ts
import type { Database } from "bun:sqlite";

export function userTeamIds(db: Database, userId: string): string[] {
  return (db.query("SELECT team_id FROM team_members WHERE user_id = ?").all(userId) as { team_id: string }[]).map((r) => r.team_id);
}
export function isTeamMember(db: Database, teamId: string, userId: string): boolean {
  return !!db.query("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").get(teamId, userId);
}
function isOwner(db: Database, teamId: string, userId: string): boolean {
  const r = db.query("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?").get(teamId, userId) as { role: string } | null;
  return r?.role === "owner";
}

export interface TeamSummary { id: string; name: string; owner_id: string; role: string; }
export interface TeamDetail { id: string; name: string; owner_id: string; members: { user_id: string; username: string; role: string }[]; }
export type AddResult = "ok" | "not_owner" | "no_team" | "no_user" | "exists";

export function createTeam(db: Database, name: string, ownerId: string): string {
  const id = crypto.randomUUID(); const now = Date.now();
  db.run("INSERT INTO teams (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)", [id, name, ownerId, now]);
  db.run("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", [id, ownerId, now]);
  return id;
}
export function listTeams(db: Database, userId: string): TeamSummary[] {
  return db.query(
    `SELECT t.id AS id, t.name AS name, t.owner_id AS owner_id, m.role AS role
     FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.created_at`).all(userId) as TeamSummary[];
}
export function getTeam(db: Database, teamId: string, userId: string): TeamDetail | null {
  if (!isTeamMember(db, teamId, userId)) return null;
  const t = db.query("SELECT id, name, owner_id FROM teams WHERE id = ?").get(teamId) as { id: string; name: string; owner_id: string } | null;
  if (!t) return null;
  const members = db.query(
    `SELECT m.user_id AS user_id, u.username AS username, m.role AS role
     FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at`).all(teamId) as TeamDetail["members"];
  return { ...t, members };
}
export function addMember(db: Database, teamId: string, actorId: string, username: string): AddResult {
  if (!db.query("SELECT 1 FROM teams WHERE id = ?").get(teamId)) return "no_team";
  if (!isOwner(db, teamId, actorId)) return "not_owner";
  const u = db.query("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | null;
  if (!u) return "no_user";
  if (isTeamMember(db, teamId, u.id)) return "exists";
  db.run("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)", [teamId, u.id, Date.now()]);
  return "ok";
}
export function removeMember(db: Database, teamId: string, actorId: string, targetId: string): "ok" | "forbidden" {
  const owner = isOwner(db, teamId, actorId);
  if (!owner && actorId !== targetId) return "forbidden";       // 非 owner 只能移除自己
  if (owner && targetId === actorId) return "forbidden";        // owner 离开请走 deleteTeam
  db.run("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, targetId]);
  return "ok";
}
export function deleteTeam(db: Database, teamId: string, actorId: string): "ok" | "forbidden" {
  if (!isOwner(db, teamId, actorId)) return "forbidden";
  db.run("UPDATE scenarios SET team_id = NULL WHERE team_id = ?", [teamId]); // 共享场景回退私有
  db.run("DELETE FROM team_members WHERE team_id = ?", [teamId]);
  db.run("DELETE FROM teams WHERE id = ?", [teamId]);
  return "ok";
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test server/teams.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/server/db.ts apps/coms-dashboard/server/teams.ts apps/coms-dashboard/server/teams.test.ts
git commit -m "feat(server): teams + team_members + membership logic"
```

---

### Task 2: db 可见性含团队 + isScenarioOwner + upsertScenario teamId

**Files:** Modify `server/db.ts`、`server/db.test.ts`

- [ ] **Step 1: 改 `listScenarios` / `getScenario`,加 `isScenarioOwner`,改 `upsertScenario`**

```ts
export function listScenarios(db: Database, userId: string): ScenarioRow[] {
  return db.query(
    `SELECT id, title, blurb, builtin FROM scenarios
     WHERE owner_id = ? OR owner_id IS NULL OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
     ORDER BY builtin DESC, title`,
  ).all(userId, userId) as ScenarioRow[];
}

export function getScenario(db: Database, id: string | undefined, userId: string): ScenarioDef | null {
  if (!id) return null;
  const row = db.query("SELECT data, owner_id, team_id FROM scenarios WHERE id = ?").get(id) as { data: string; owner_id: string | null; team_id: string | null } | null;
  if (!row) return null;
  const visible = row.owner_id === null || row.owner_id === userId ||
    (row.team_id !== null && !!db.query("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").get(row.team_id, userId));
  return visible ? (JSON.parse(row.data) as ScenarioDef) : null;
}

export function getScenarioTeamId(db: Database, id: string): string | null {
  const row = db.query("SELECT team_id FROM scenarios WHERE id = ?").get(id) as { team_id: string | null } | null;
  return row?.team_id ?? null;
}

export function isScenarioOwner(db: Database, id: string, userId: string): boolean {
  const row = db.query("SELECT owner_id FROM scenarios WHERE id = ?").get(id) as { owner_id: string | null } | null;
  return !!row && row.owner_id === userId;
}

export function upsertScenario(db: Database, s: ScenarioDef, builtin: boolean, ownerId: string | null, teamId: string | null = null): void {
  const now = Date.now();
  db.run(
    `INSERT INTO scenarios (id, title, blurb, data, builtin, owner_id, team_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, blurb=excluded.blurb,
       data=excluded.data, owner_id=excluded.owner_id, team_id=excluded.team_id, updated_at=excluded.updated_at`,
    [s.id, s.title, s.blurb, JSON.stringify(s), builtin ? 1 : 0, ownerId, teamId, now, now],
  );
}
```

> `upsertScenario` 的 `teamId` 默认 `null`,故 D1 既有调用(`upsertScenario(db, s, true, null)` / `(db, body, false, uid)`)无需改动即向后兼容。

- [ ] **Step 2: db.test.ts 加团队可见性测试(现有断言不受影响,因 teamId 默认 null)**

```ts
import { createUser } from "./auth";
import { createTeam, addMember } from "./teams";
import { isScenarioOwner, getScenarioTeamId } from "./db";

test("团队共享场景:成员可见、非成员不可见", () => {
  const db = freshDb();
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h"); const c = createUser(db, "carol", "h");
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob");
  upsertScenario(db, { ...demo, id: "shared" }, false, a, t);
  expect(listScenarios(db, b).map((s) => s.id)).toContain("shared"); // 成员可见
  expect(getScenario(db, "shared", b)?.id).toBe("shared");
  expect(listScenarios(db, c).map((s) => s.id)).not.toContain("shared"); // 非成员不可见
  expect(getScenario(db, "shared", c)).toBeNull();
  expect(isScenarioOwner(db, "shared", a)).toBe(true);
  expect(isScenarioOwner(db, "shared", b)).toBe(false);
  expect(getScenarioTeamId(db, "shared")).toBe(t);
});
```

- [ ] **Step 3: 跑 db + teams 测试**

Run: `cd apps/coms-dashboard && bun test server/db.test.ts server/teams.test.ts`
Expected: PASS（db 7 + teams 5）。

- [ ] **Step 4: Commit**

```bash
git add apps/coms-dashboard/server/db.ts apps/coms-dashboard/server/db.test.ts
git commit -m "feat(server): scenario visibility includes team-shared; isScenarioOwner; teamId column"
```

---

### Task 3: index.ts 团队路由 + scenarios teamId + 集成测试

**Files:** Modify `server/index.ts`、`server/server.integration.test.ts`

- [ ] **Step 1: import teams + db 新函数**

`index.ts` 顶部:
```ts
import { createTeam, listTeams, getTeam, addMember, removeMember, deleteTeam } from "./teams";
```
（`isScenarioOwner`/`getScenarioTeamId` 经 `dbm.` 访问。)

- [ ] **Step 2: 在 scenarios 路由之前(中间件 `const uid = user.id;` 之后)加团队路由**

```ts
      // ---- teams ----
      if (req.method === "GET" && p === "/api/teams") return json({ teams: listTeams(deps.db, uid) });
      if (req.method === "POST" && p === "/api/teams") {
        const { name } = (await req.json()) as { name: string };
        if (!name?.trim()) return json({ error: "团队名不能为空" }, 400);
        return json({ id: createTeam(deps.db, name.trim(), uid) });
      }
      const teamMemMatch = p.match(/^\/api\/teams\/([^/]+)\/members(?:\/([^/]+))?$/);
      if (teamMemMatch) {
        const teamId = decodeURIComponent(teamMemMatch[1]);
        if (req.method === "POST" && !teamMemMatch[2]) {
          const { username } = (await req.json()) as { username: string };
          const r = addMember(deps.db, teamId, uid, username ?? "");
          if (r === "ok") return json({ ok: true });
          const code = r === "not_owner" ? 403 : r === "no_user" || r === "no_team" ? 404 : 409;
          return json({ error: r }, code);
        }
        if (req.method === "DELETE" && teamMemMatch[2]) {
          const r = removeMember(deps.db, teamId, uid, decodeURIComponent(teamMemMatch[2]));
          return r === "ok" ? json({ ok: true }) : json({ error: "forbidden" }, 403);
        }
      }
      const teamIdMatch = p.match(/^\/api\/teams\/([^/]+)$/);
      if (teamIdMatch) {
        const teamId = decodeURIComponent(teamIdMatch[1]);
        if (req.method === "GET") { const t = getTeam(deps.db, teamId, uid); return t ? json({ team: t }) : json({ error: "not found" }, 404); }
        if (req.method === "DELETE") { const r = deleteTeam(deps.db, teamId, uid); return r === "ok" ? json({ ok: true }) : json({ error: "forbidden" }, 403); }
      }
```

- [ ] **Step 3: scenarios POST/PUT 接受 teamId;GET/:id 返回 teamId;PUT/DELETE 用 isScenarioOwner**

POST `/api/scenarios`:
```ts
      if (req.method === "POST" && p === "/api/scenarios") {
        const body = (await req.json()) as ScenarioDef & { teamId?: string | null };
        const errs = validate(body);
        if (errs.length) return json({ error: "invalid", details: errs }, 400);
        const teamId = body.teamId ?? null;
        if (teamId && !require_member(deps.db, teamId, uid)) return json({ error: "无权共享到该团队" }, 400);
        dbm.upsertScenario(deps.db, body, false, uid, teamId);
        return json({ ok: true, id: body.id });
      }
```
其中在 `buildServer` 内定义小助手(或直接用 `getTeam(deps.db,teamId,uid)!==null`):
```ts
      const require_member = (db: Database, teamId: string, userId: string) => getTeam(db, teamId, userId) !== null;
```
（放在 handler 顶部 `const uid` 之后即可。）

GET `/api/scenarios/:id`:
```ts
        if (req.method === "GET") {
          const s = dbm.getScenario(deps.db, id, uid);
          return s ? json({ scenario: s, teamId: dbm.getScenarioTeamId(deps.db, id) }) : json({ error: "not found" }, 404);
        }
```
PUT:把 `if (!dbm.getScenario(deps.db, id, uid)) 404` 之外,改归属校验为 `isScenarioOwner`:
```ts
        if (req.method === "PUT") {
          if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可改,请先 duplicate" }, 409);
          if (!dbm.isScenarioOwner(deps.db, id, uid)) return json({ error: "无权修改(非创建者)" }, 403);
          const body = (await req.json()) as ScenarioDef & { teamId?: string | null };
          const errs = validate(body);
          if (errs.length) return json({ error: "invalid", details: errs }, 400);
          const teamId = body.teamId ?? null;
          if (teamId && !require_member(deps.db, teamId, uid)) return json({ error: "无权共享到该团队" }, 400);
          dbm.upsertScenario(deps.db, body, false, uid, teamId);
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可删,请先 duplicate" }, 409);
          if (!dbm.isScenarioOwner(deps.db, id, uid)) return json({ error: "无权删除(非创建者)" }, 403);
          dbm.deleteScenario(deps.db, id);
          return json({ ok: true });
        }
```
（duplicate 源仍用 `dbm.getScenario(deps.db, id, uid)`,复制出的副本 `upsertScenario(...,uid,null)` 私有。)

- [ ] **Step 4: 集成测试加团队共享用例**

`server.integration.test.ts` 末尾加:
```ts
test("团队共享:成员可见且只读,非成员不可见", async () => {
  const { handler } = harness();
  const a = await register(handler, "ta", "p");
  const b = await register(handler, "tb", "p");
  const c = await register(handler, "tc", "p");
  // a 建团队 + 加 b
  const { id: teamId } = await (await call(handler, "POST", "/api/teams", a, { name: "dev" })).json();
  expect((await call(handler, "POST", `/api/teams/${teamId}/members`, a, { username: "tb" })).status).toBe(200);
  // a 建一个共享场景
  const scnX = { id: "shareX", title: "X", blurb: "b", roles: [{ name: "r", provider: "x", model: "x", purpose: "", color: "#000" }], input: { label: "l", default: "d" }, steps: [{ id: "s1", role: "r", prompt: "{{input}}", after: [] }], teamId };
  expect((await call(handler, "POST", "/api/scenarios", a, scnX)).status).toBe(200);
  // b 成员可见且 GET 200,但 PUT 403
  expect((await (await call(handler, "GET", "/api/scenarios", b)).json()).scenarios.map((s: { id: string }) => s.id)).toContain("shareX");
  expect((await call(handler, "PUT", "/api/scenarios/shareX", b, { ...scnX, teamId: null })).status).toBe(403);
  // c 非成员不可见
  expect((await (await call(handler, "GET", "/api/scenarios", c)).json()).scenarios.map((s: { id: string }) => s.id)).not.toContain("shareX");
  expect((await call(handler, "GET", "/api/scenarios/shareX", c)).status).toBe(404);
});
```

- [ ] **Step 5: 跑后端全套 + tsc**

Run: `cd apps/coms-dashboard && bun test server/ && bunx tsc --noEmit`
Expected: 全绿(teams 5 + db 7 + auth 5 + hubClient 3 + runHub 2 + runner 2 + 集成 7),tsc 无输出。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/server/index.ts apps/coms-dashboard/server/server.integration.test.ts
git commit -m "feat(server): team routes + scenario teamId sharing (owner-only edit)"
```

---

# 阶段:前端(Task 4–5)

### Task 4: client teams + 编辑器可见性 + 团队模态 + 入口

**Files:** Modify `src/api/client.ts`、`src/components/ScenarioChat.tsx`、`src/components/ScenarioEditor.tsx`;Create `src/components/Teams.tsx`;Modify `src/styles.css`

- [ ] **Step 1: client.ts —— teams API + teamId 参数 + getScenarioFull**

在 `api` 对象内:
- `getScenario` 保持返回 `ScenarioDef`(后端现返回 `{scenario,teamId}`,此方法仍取 scenario):
  ```ts
  getScenario: (id: string) => j<{ scenario: ScenarioDef; teamId: string | null }>(`/api/scenarios/${encodeURIComponent(id)}`).then((r) => r.scenario),
  ```
- 新增 `getScenarioFull`:
  ```ts
  getScenarioFull: (id: string) => j<{ scenario: ScenarioDef; teamId: string | null }>(`/api/scenarios/${encodeURIComponent(id)}`),
  ```
- `createScenario`/`updateScenario` 加可选 `teamId`:
  ```ts
  createScenario: (s: ScenarioDef, teamId: string | null = null) => j<{ ok: boolean; id: string }>("/api/scenarios", { method: "POST", body: JSON.stringify({ ...s, teamId }) }),
  updateScenario: (id: string, s: ScenarioDef, teamId: string | null = null) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...s, teamId }) }),
  ```
- 新增 `teams`(在 `api` 对象之外、与 `auth` 并列导出):
  ```ts
  export interface TeamSummary { id: string; name: string; owner_id: string; role: string; }
  export interface TeamMember { user_id: string; username: string; role: string; }
  export interface TeamDetail { id: string; name: string; owner_id: string; members: TeamMember[]; }
  export const teams = {
    list: () => j<{ teams: TeamSummary[] }>("/api/teams").then((r) => r.teams),
    create: (name: string) => j<{ id: string }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) }),
    get: (id: string) => j<{ team: TeamDetail }>(`/api/teams/${encodeURIComponent(id)}`).then((r) => r.team),
    addMember: (id: string, username: string) => j(`/api/teams/${encodeURIComponent(id)}/members`, { method: "POST", body: JSON.stringify({ username }) }),
    removeMember: (id: string, userId: string) => j(`/api/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    remove: (id: string) => j(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
  ```

- [ ] **Step 2: Teams.tsx(团队管理模态)**

```tsx
// src/components/Teams.tsx
import { useEffect, useState } from "react";
import { teams as teamApi, type TeamSummary, type TeamDetail } from "../api/client";

export function Teams({ currentUserId, onClose }: { currentUserId: string; onClose: () => void }) {
  const [list, setList] = useState<TeamSummary[]>([]);
  const [sel, setSel] = useState<TeamDetail | null>(null);
  const [name, setName] = useState("");
  const [addName, setAddName] = useState("");
  const [err, setErr] = useState("");

  const refresh = () => teamApi.list().then(setList).catch(() => setErr("加载团队失败"));
  useEffect(() => { refresh(); }, []);
  async function open(id: string) { setErr(""); try { setSel(await teamApi.get(id)); } catch { setErr("加载失败"); } }
  async function create() { if (!name.trim()) return; await teamApi.create(name.trim()); setName(""); refresh(); }
  async function add() { if (!sel || !addName.trim()) return; try { await teamApi.addMember(sel.id, addName.trim()); setAddName(""); open(sel.id); } catch (e) { setErr(parseErr(e)); } }
  async function remove(userId: string) { if (!sel) return; await teamApi.removeMember(sel.id, userId).catch((e) => setErr(parseErr(e))); if (userId === currentUserId) { setSel(null); refresh(); } else open(sel.id); }
  async function del() { if (!sel) return; await teamApi.remove(sel.id).catch((e) => setErr(parseErr(e))); setSel(null); refresh(); }

  const isOwner = sel?.owner_id === currentUserId;
  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="teams-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head"><strong>团队</strong><button className="result-close" onClick={onClose}>✕</button></div>
        {err && <div className="editor-errors">⚠ {err}</div>}
        <div className="teams-body">
          <div className="teams-list">
            {list.map((t) => <div key={t.id} className={`history-item ${sel?.id === t.id ? "on" : ""}`} onClick={() => open(t.id)}>
              <div className="history-item-top"><b>{t.name}</b><span className="history-time">{t.role}</span></div></div>)}
            <div className="teams-create">
              <input placeholder="新团队名" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
              <button onClick={create}>建团队</button>
            </div>
          </div>
          <div className="teams-detail">
            {!sel && <div className="chat-empty">选择或创建一个团队。</div>}
            {sel && <>
              <div className="teams-detail-head"><strong>{sel.name}</strong>{isOwner && <button className="editor-del" onClick={del}>删除团队</button>}</div>
              {sel.members.map((m) => <div key={m.user_id} className="teams-member">
                <span>{m.username} <span className="editor-muted">· {m.role}</span></span>
                {((isOwner && m.role !== "owner") || m.user_id === currentUserId) && <button onClick={() => remove(m.user_id)}>{m.user_id === currentUserId ? "离开" : "移除"}</button>}
              </div>)}
              {isOwner && <div className="teams-create">
                <input placeholder="按用户名加成员" value={addName} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
                <button onClick={add}>添加</button>
              </div>}
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}
function parseErr(e: unknown): string {
  const m = String(e); const map: Record<string, string> = { not_owner: "仅团队 owner 可操作", no_user: "查无此用户", exists: "已是成员", forbidden: "无权限" };
  for (const k in map) if (m.includes(k)) return map[k];
  return "操作失败";
}
```

- [ ] **Step 3: ScenarioEditor 加可见性下拉**

import 顶部加:
```tsx
import { teams as teamApi, type TeamSummary } from "../api/client";
```
props 加 `initialTeamId: string | null`;组件内:
```tsx
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  const [myTeams, setMyTeams] = useState<TeamSummary[]>([]);
  useEffect(() => { teamApi.list().then(setMyTeams).catch(() => {}); }, []);
```
保存改:`isNew ? api.createScenario(s, teamId) : api.updateScenario(s.id, s, teamId)`。
在 ID 字段那组下面加可见性区:
```tsx
          <label className="editor-field"><span>可见性</span>
            <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)}>
              <option value="">私有(仅自己)</option>
              {myTeams.map((t) => <option key={t.id} value={t.id}>团队:{t.name}</option>)}
            </select>
          </label>
```

- [ ] **Step 4: ScenarioChat —— editor 状态带 teamId + 团队入口**

- 把 `editorInitial` 状态改为带 teamId 的对象:
  ```tsx
  const [editorState, setEditorState] = useState<{ initial: ScenarioDef | null; teamId: string | null } | null>(null);
  const [showTeams, setShowTeams] = useState(false);
  const [meId, setMeId] = useState("");
  useEffect(() => { import("../api/client").then(({ auth }) => auth.me().then((u) => setMeId(u.id)).catch(() => {})); }, []);
  ```
  （`meId` 供 Teams 判断 owner;也可由 App 传入,但此处自取最省改动。)
- `openEdit`:
  ```tsx
  async function openEdit() {
    if (!current) return;
    if (current.builtin) { const { id } = await api.duplicateScenario(sid); const f = await api.getScenarioFull(id); setEditorState({ initial: f.scenario, teamId: f.teamId }); }
    else { const f = await api.getScenarioFull(sid); setEditorState({ initial: f.scenario, teamId: f.teamId }); }
  }
  ```
- `onEditorSaved` 不变(刷新 + 关闭用 `setEditorState(null)`)。
- 「+ 新建」`onClick={() => setEditorState({ initial: null, teamId: null })}`。
- 头部加「团队」按钮:`<button className="result-open" onClick={() => setShowTeams(true)}>团队</button>`。
- 渲染:
  ```tsx
  {editorState && <ScenarioEditor initial={editorState.initial} initialTeamId={editorState.teamId} onClose={() => setEditorState(null)} onSaved={onEditorSaved} />}
  {showTeams && <Teams currentUserId={meId} onClose={() => setShowTeams(false)} />}
  ```
- import `Teams`。删除旧 `editorInitial` 相关用法(全部改 `editorState`)。

- [ ] **Step 5: 样式 `.teams-*`(追加 styles.css)**

```css
.teams-modal { width: 720px; max-width: 94vw; height: 78vh; display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--hairline); border-radius: 14px; box-shadow: var(--shadow-hover); overflow: hidden; }
.teams-body { flex: 1; display: grid; grid-template-columns: 240px 1fr; min-height: 0; }
.teams-list { border-right: 1px solid var(--hairline); overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.teams-detail { overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.teams-detail-head { display: flex; align-items: center; gap: 10px; }
.teams-detail-head .editor-del { margin-left: auto; }
.teams-member { display: flex; align-items: center; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px solid var(--hairline-soft); }
.teams-member button { border: 1px solid var(--hairline); background: var(--card); border-radius: 7px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.teams-create { display: flex; gap: 6px; margin-top: 8px; }
.teams-create input { flex: 1; font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--hairline); border-radius: 8px; background: var(--card); color: var(--text); }
.teams-create button { border: 1px solid var(--hairline); background: var(--muted-surface); border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
```

- [ ] **Step 6: 验证编译 + Commit**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。
```bash
git add apps/coms-dashboard/src/api/client.ts apps/coms-dashboard/src/components/Teams.tsx apps/coms-dashboard/src/components/ScenarioEditor.tsx apps/coms-dashboard/src/components/ScenarioChat.tsx apps/coms-dashboard/src/styles.css
git commit -m "feat(web): teams modal + scenario visibility selector + team entry"
```

---

### Task 5: 全套验证 + 浏览器人工验收

- [ ] **Step 1: tsc + 全套测试 + build**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && bun test && bun run build`
Expected: tsc 无输出;`bun test` 全绿(72 + teams 5 + db 1 + 集成 1 ≈ 79+);build 成功。

- [ ] **Step 2: 启动并人工验收**

```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server
just server
cd apps/coms-dashboard && bun run dev
```
http://localhost:5273:
1. 用 alice 登录 → 点「团队」→ 建团队「dev」。
2. 新建/编辑一个自己的场景 → 可见性选「团队:dev」→ 保存。
3. 「团队」→ dev → 按用户名添加 `bob`(若无 bob,先登出注册一个)。
4. 登出 → 以 bob 登录 → 场景下拉能看到 alice 共享的那个(只读:点「编辑」实为对自己副本;PUT 原场景会 403)、看不到 alice 的私有场景。
5. 注册第三个用户 carol → 看不到该团队场景。
6. alice 删除团队 dev → 该共享场景回退为 alice 私有(bob 不再可见)。
7. 控制台 0 报错(favicon 忽略)。

- [ ] **Step 3: Commit(收尾,可空)**

```bash
git commit --allow-empty -m "chore(D2): teams + sharing verified end-to-end"
```

---

## Self-Review(已执行)

- **Spec 覆盖:** D2.1 表/迁移→Task 1;D2.2 可见性 + isScenarioOwner + upsert teamId→Task 2;D2.3 团队 API + scenarios teamId + GET/:id 返回 teamId + PUT/DELETE owner→Task 3;D2.4 前端(client.teams、Teams 模态、编辑器可见性、来源/入口)→Task 4;D2.6 错误(403/404/409/400/删团队回退)→Task 1(removeMember/deleteTeam)+ Task 3(路由码);D2.7 测试→Task 1/2/3 + Task 5。
- **占位符扫描:** 无 TBD;给出完整代码(teams.ts、db 函数、路由代码块、Teams.tsx、编辑器/接线 diff、CSS、各测试)。Task 3/4 的修改为精确 diff 指令 + 完整代码块。
- **类型一致性:** `teams.ts` 导出(createTeam/listTeams/getTeam/addMember/removeMember/deleteTeam/userTeamIds/isTeamMember)与 index 路由(Task 3)、teams.test(Task 1)一致;`upsertScenario(db,s,builtin,ownerId,teamId=null)`(Task 2)向后兼容 D1 调用,Task 3 传 teamId;`getScenarioTeamId`/`isScenarioOwner`(Task 2)在 index(Task 3)用;`client.teams`/`getScenarioFull`/`createScenario(s,teamId)`/`updateScenario(id,s,teamId)`(Task 4 client)与 Teams.tsx、ScenarioEditor、ScenarioChat 使用一致;`ScenarioEditor` 新增 prop `initialTeamId`(Task 4 Step3)与 ScenarioChat 渲染(Step4)一致;`Teams` props `{currentUserId,onClose}` 与渲染一致。
- **已知取舍:** run 仍按 owner 私有(团队不共享 run);ScenarioChat 自取 `meId`(auth.me)供 Teams 判 owner,省去从 App 透传;前端组件无单测,靠 tsc + 浏览器,纯逻辑(teams/db)已单测。`editorInitial`(D1/C 的三态)重构为 `editorState` 对象——Task 4 须替换其全部既有用法。
