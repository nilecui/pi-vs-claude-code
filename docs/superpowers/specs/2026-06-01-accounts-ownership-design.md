# 账号 + 归属隔离(子项目 D1)设计

> 平台第五块(D 的第一轮)。承接 B 的后端(Bun + SQLite + REST/SSE,目前 `/api` 无鉴权)。加用户账号、会话鉴权,把 scenarios/runs 按 owner 隔离。**D2(团队/组织 + 共享)留作下一轮。**

**目标:** 注册/登录后才能用面板;各用户只见自己的场景与运行(内置场景全员只读);`/api` 经会话 cookie 鉴权;无凭证 401。

**架构:** `server/auth.ts`(密码哈希 + 会话,纯部分可测)+ `buildServer` 鉴权中间件 + db 层加 `ownerId` 维度做数据隔离 + 前端 `Login` 页与 `me()` 启动门禁。鉴权方式:用户名/密码(`Bun.password` argon2,无依赖)+ httpOnly session cookie。

**技术栈:** Bun(`Bun.password`、`bun:sqlite`)+ TS;前端 React18 + Zustand + Vite。无新增依赖。

**分支:** `coms-dashboard-terminals`(A+B+C+E 已完成)。

---

## D1.1 数据模型(迁移幂等)

新增表:
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL );
```
`scenarios`、`runs` 各加可空列 `owner_id`:迁移用 `PRAGMA table_info(<t>)` 检测,缺列则 `ALTER TABLE <t> ADD COLUMN owner_id TEXT`。
- `scenarios.owner_id`:`NULL` = 内置/公共只读(与 `builtin=1` 一致);非空 = 某用户私有。
- `runs.owner_id`:`NULL` = 旧无主历史;非空 = 发起用户。
- 迁移幂等(列已存在跳过);现有数据 `owner_id` 保持 `NULL`。

## D1.2 鉴权层 `server/auth.ts`

- `hashPassword(pw): Promise<string>` = `Bun.password.hash(pw)`;`verifyPassword(pw, hash): Promise<boolean>` = `Bun.password.verify(pw, hash)`。
- `createSession(db, userId, ttlMs=7*864e5): string`(生成 token、写 sessions、返回 token)。
- `getSessionUser(db, token): { id, username } | null`(查 sessions 未过期 → 关联 users;过期/无效返回 null)。
- `deleteSession(db, token)`。
- 用户:`createUser(db, username, hash): string`(uuid id;username 唯一冲突抛错)、`getUserByName(db, username)`。
- 纯/可测:`hashPassword`+`verifyPassword` 往返、错误密码、`getSessionUser` 过期判断(用可注入的 now 或写一条过期 session 验证)。

## D1.3 鉴权路由 + 中间件(`server/index.ts`)

鉴权路由(**不**经中间件):
- `POST /api/auth/register {username,password}` → 创建用户(用户名占用 409;密码空 400)→ 建 session → `Set-Cookie: coms_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=…` → 返回 `{user:{id,username}}`。
- `POST /api/auth/login {username,password}` → 验证 → 建 session + Set-Cookie → `{user}`;失败 401。
- `POST /api/auth/logout` → 删 session + 过期 cookie → `{ok}`。
- `GET /api/auth/me` → 有效 session 返回 `{user}`,否则 401。

**中间件**:`buildServer` 的 handler 开头,对 `p.startsWith("/api/")` 且非 `/api/auth/` 且非 `/api/health`:从 `Cookie` 头解析 `coms_session` → `getSessionUser`;无效 → `401 {error:"unauthorized"}`;有效 → 把 `userId` 传入各路由处理(经闭包变量或参数)。SSE 路由 `/api/runs/:id/events` 同样受护(EventSource 同源自动带 cookie)。

> `ServerDeps` 不变;鉴权在 handler 内完成(从 db 查 session)。db 调用传入 `userId`。

## D1.4 数据隔离(`server/db.ts` 加 ownerId 维度)

改签名(全部 call sites 同步更新):
- `listScenarios(db, userId)` → `WHERE owner_id = ? OR owner_id IS NULL`(本人 + 内置/公共)。
- `getScenario(db, id, userId)` → 命中且(`owner_id=userId` 或 `NULL`)才返回,否则 `null`(越权当不存在)。
- `upsertScenario(db, s, builtin, ownerId)` → 写 `owner_id`(新建/更新均设当前用户;内置 seed 传 `null`)。
- `isBuiltin` 不变(按 builtin 列)。删除/PUT 前在路由校验 `owner_id=userId`(非本人 → 403/404)。
- `createRun(db, scenarioId, input, ownerId)`、`listRuns(db, userId, scenarioId?)`(`WHERE owner_id=?` [+ scenario])、`getRun(db, id, userId)`(校验归属)。
- `duplicate`:复制内置/他人可见场景 → 新场景 `owner_id=当前用户`、`builtin=0`。
- seed 内置仍 `owner_id=NULL, builtin=1`。

## D1.5 前端

- `api/client.ts`:所有 `fetch` 加 `credentials: "include"`;新增 `auth = { register, login, logout, me }`;`j()` 在 401 时抛特定错误供上层捕获切登录态。
- `src/components/Login.tsx`:用户名/密码表单 + 登录/注册切换 + 错误显示;成功回调 `onAuthed(user)`。
- `src/App.tsx`:启动 `api.auth.me()`;state `user`:`undefined`(加载中)/`null`(未登录→渲染 `<Login>`)/`{...}`(渲染面板)。顶部 brand 区显示当前用户名 + 「登出」(`logout()` → setUser(null))。
- 登录后才挂载现有面板(TerminalStrip/三栏);未登录只显示 Login,不连 hub/不拉场景。

## D1.6 绑定 / 部署

- `Bun.serve` 的 `hostname` 改为读 `process.env.COMS_SERVER_HOST ?? "127.0.0.1"`;文档说明:跨机多用户访问可设 `COMS_SERVER_HOST=0.0.0.0`(鉴权已就位)。默认不变。

## D1.7 数据流

```
启动 → api.auth.me()
  401 → <Login> → register/login → Set-Cookie session → setUser → 面板
  200 → 面板
面板内 /api/* 请求带 cookie → 中间件 getSessionUser → userId
  db 查询按 userId 过滤(本人 + 内置只读)
401(会话失效)→ 前端切回 <Login>
```

## D1.8 错误处理 / 边界

- 用户名占用 409;密码空/过短 400;登录失败 401(不区分用户名/密码错,防枚举)。
- 越权访问他人 scenario/run → 当作 404(不泄露存在性)。
- session 过期 → `getSessionUser` 返回 null → 401 → 前端登出。
- 现有无主数据(`owner_id=NULL` 的自定义场景/历史 run):scenarios 的 NULL 视为公共只读;runs 的 NULL 不归任何人(各用户 `listRuns` 不显示 NULL run,避免泄露)。

## D1.9 测试

- `auth.test.ts`:`hashPassword`/`verifyPassword` 往返成功 + 错密码 false;`createSession`+`getSessionUser` 取回 user;过期 session → null;`deleteSession` 后 null;`createUser` 重名抛错。
- `db` owner 测试:`listScenarios` 只返回本人+NULL;`getScenario/getRun` 越权返回 null;`listRuns` 按 owner 过滤、排除 NULL。
- 集成:注册→拿 Set-Cookie→带 cookie `GET /api/scenarios` 200;无 cookie `GET /api/scenarios` 401;用户 A 建 run,用户 B `listRuns` 看不到;`/api/auth/me` 无 cookie 401、有 cookie 200;`/api/health` 免鉴权。
- 前端:tsc + 浏览器人工验收。
- **回归**:db 函数签名变更(加 `ownerId`/`userId`)+ `runner.startRun` 加 `ownerId` 会影响 B 现有测试(`db.test.ts`/`runner.test.ts`/`server.integration.test.ts`)与调用点 —— 计划须同步更新它们(集成测试改为先注册/登录拿 cookie 再调 `/api`),保持全绿。

## D1.10 非目标(留 D2 / 以后)

- 团队/组织、场景共享、成员角色(D2)。
- 邀请码/封闭注册、admin 后台、密码重置/邮箱。
- 强制 `0.0.0.0`、HTTPS/TLS 终止(部署层)。
- 把旧无主数据归并到首用户(本期保持 NULL 语义)。

## 完成判据

- 未登录访问面板 → 显示登录页;注册/登录后进入面板。
- 无 cookie 调 `/api/scenarios`(等)→ 401;`/api/health` 仍 200。
- 用户 A、B 各自登录:A 建的场景/运行 B 看不到;内置 3 场景两人都能看(只读、可复制为自己的)。
- 登出后回到登录页;再访问 `/api` 401。
- `bun test` 全绿(现有 61 + 新 auth/owner/集成);`tsc` 干净;`bun run build` 成功。
