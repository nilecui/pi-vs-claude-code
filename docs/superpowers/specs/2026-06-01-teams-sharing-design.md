# 团队 + 场景共享(子项目 D2)设计

> 平台第六块(D 的第二轮,收尾)。承接 D1(账号 + session 鉴权 + scenarios/runs 按 owner 隔离)。加团队、把场景在团队内共享。

**目标:** 用户可建/加入团队;场景可见性 = 私有(仅 owner)或 共享给某团队(成员可见、只读、可复制);owner 管理成员。run 仍各人私有。

**架构:** 新表 `teams`/`team_members` + `scenarios.team_id` 列;db 可见性查询扩展(本人 ∪ 内置 ∪ 我所属团队);团队 REST API;前端团队管理模态 + 编辑器可见性选择。

**技术栈:** Bun + bun:sqlite + TS;React18 + Vite;`bun test`。无新增依赖。

**分支:** `coms-dashboard-terminals`(A/B/C/E/D1 已完成)。

---

## D2.1 数据模型(迁移幂等)

```sql
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,  -- 'owner' | 'member'
  created_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id) );
```
`scenarios` 加可空列 `team_id`(`PRAGMA table_info` 检测缺列则 `ALTER TABLE scenarios ADD COLUMN team_id TEXT`)。
- `team_id IS NULL` = 私有(D1 行为,仅 owner 可见可改)。
- `team_id` 非空 = 共享给该团队(成员可见只读;仅 `owner_id` 可改)。
- 创建团队:写 `teams` + 一条 `team_members(team_id, owner, 'owner')`。

## D2.2 可见性 / 权限(db 改)

新增 `server/teams.ts`(纯 db 逻辑,可测):
- `userTeamIds(db, userId): string[]`。
- `createTeam(db, name, ownerId): string`(建 team + owner 成员行)。
- `listTeams(db, userId): {id,name,role,owner_id}[]`(我所属团队 + 我的角色)。
- `getTeam(db, teamId, userId): {id,name,owner_id,members:{user_id,username,role}[]} | null`(非成员返回 null)。
- `addMember(db, teamId, actorId, username): 'ok'|'not_owner'|'no_team'|'no_user'|'exists'`(仅 owner)。
- `removeMember(db, teamId, actorId, targetId)`(owner 移除任意成员;成员可移除自己=离开;不可移除 owner 自身,删团队另走)。
- `deleteTeam(db, teamId, actorId)`(仅 owner;级联删 team_members;把该团队的 scenarios.team_id 置 NULL=回退为各自私有)。
- `isTeamMember(db, teamId, userId): boolean`。

改 `server/db.ts`:
- `listScenarios(db, userId)`:`WHERE owner_id = ? OR owner_id IS NULL OR team_id IN (<userTeamIds>)`。
- `getScenario(db, id, userId)`(读):命中且(`owner_id=userId` 或 `owner_id IS NULL` 或 `team_id ∈ userTeamIds`)→ 返回,否则 null。
- 新增 `isScenarioOwner(db, id, userId): boolean`(`owner_id = userId`)—— PUT/DELETE 用它(非 owner → 403)。
- `upsertScenario(db, s, builtin, ownerId, teamId)`:写 `team_id`(私有传 null)。seed 内置 `teamId=null`。
- `createRun`/`getRun`/`listRuns` 不变(run 仍按 owner 私有)。但 `POST /api/runs` 取场景改用可见性版 `getScenario`(成员能跑团队共享场景)。

## D2.3 团队 API(`server/index.ts`,均在 session 中间件之后)

| 方法 路径 | 行为 |
|---|---|
| `GET /api/teams` | `listTeams(db, uid)` |
| `POST /api/teams {name}` | 建团队(name 非空)→ `{id}` |
| `GET /api/teams/:id` | `getTeam`;非成员 404 |
| `POST /api/teams/:id/members {username}` | `addMember`;非 owner 403、无此用户 404、已是成员 409 |
| `DELETE /api/teams/:id/members/:userId` | owner 移除任意 / 本人离开;否则 403 |
| `DELETE /api/teams/:id` | `deleteTeam`;非 owner 403 |

场景共享:`POST`/`PUT /api/scenarios` 请求体 = `ScenarioDef` 之外可选字段 `teamId`(`null`=私有;非空须是 uid 所属团队,否则 400)。服务端 `validate(ScenarioDef)` 后 `upsertScenario(..., uid, teamId)`。PUT/DELETE 前用 `isScenarioOwner` 校验(非 owner 403)。

## D2.4 前端

- **团队管理** `src/components/Teams.tsx`(模态):我的团队列表(名/角色);建团队(输入名);进入团队 → 成员列表 + owner 可「按用户名添加/移除成员」「删除团队」、成员可「离开」。入口:左栏工具区或顶部加「团队」按钮。
- **client.ts**:加 `teams = { list, create, get, addMember, removeMember, remove }`。
- **场景编辑器** `ScenarioEditor`:加「可见性」下拉(私有 / 我所属的各团队);保存时把 `teamId` 随 `createScenario/updateScenario` 一起发(client 的这两个方法加可选 `teamId` 参数,放进请求体)。编辑器初始 `teamId` 来自后端(getScenario 需返回当前 team_id —— 见下)。
- **场景下拉来源标识**:`ScenarioSummary` 加 `team_id`/`builtin` 已有;下拉项后缀小标(内置 / 团队名 / 私有)。成员打开非本人场景仍走「复制并编辑」(只读)。
- 需要 `getScenario` 或 summary 暴露 `team_id` 以便编辑器回填可见性:`GET /api/scenarios/:id` 返回 `{ scenario, teamId }`(teamId 与 ScenarioDef 分开,因为它是平台元数据非编排数据)。

## D2.5 数据流

```
建团队 → POST /api/teams → team + owner 成员
加成员(owner)→ POST /api/teams/:id/members {username}
共享场景 → 编辑器可见性=团队X → PUT /api/scenarios/:id {..ScenarioDef, teamId:X}
成员 B 登录 → listScenarios 含 team_id∈B 的团队 → 看到该场景(只读)→ 复制并编辑成自己的
```

## D2.6 错误处理 / 边界

- 加成员:非 owner 403、无此用户 404、重复 409、加自己 noop/409。
- 设 `teamId` 为非本人所属团队 → 400(防越权共享)。
- 删团队 → 其 `scenarios.team_id` 置 NULL(共享场景回退为 owner 私有,不丢)。
- 成员对团队共享场景 PUT/DELETE → 403(只读);可 duplicate 为自己的(归 owner=自己、team_id=null)。
- 越权读非可见场景 → 404。

## D2.7 测试

- `teams.test.ts`:createTeam + listTeams + getTeam(成员可见/非成员 null)+ addMember(owner ok / 非 owner not_owner / 无用户 no_user / 重复 exists)+ removeMember(离开)+ deleteTeam(场景 team_id 回退 NULL)。
- `db` 可见性:team-shared 场景对成员可见、对非成员不可见;`isScenarioOwner` 仅 owner true。
- 集成:A 建团队 + 加 B;A 把 demo 复制成场景 X 设 teamId → B `listScenarios` 含 X;B `PUT X` → 403;B `GET X` 200;非成员 C `GET X` 404;B 不属于的团队 `getTeam` 404。
- 前端:tsc + 浏览器人工验收。

## D2.8 非目标

- 嵌套组织 / 多级角色 / 管理员后台;邀请码、申请-审批;run 团队可见(本期仍私有);团队级配额/计费。

## 完成判据

- A 建团队「dev」,把一个自定义场景设为「团队:dev」,加 B 为成员。
- B 登录:场景下拉出现该场景(标「团队:dev」)、只读、可复制改造;看不到 A 的私有场景。
- 非成员 C:看不到该团队场景。
- owner 能加/移除成员、删团队(共享场景回退私有);成员能离开。
- `bun test` 全绿(现有 72 + teams + db 可见性 + 集成);`tsc` 干净;`bun run build` 成功。
