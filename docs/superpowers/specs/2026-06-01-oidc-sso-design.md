# OIDC SSO 登录(子项目 F3)设计

> 承接 D1(密码 + httpOnly session cookie,users/sessions)。新增「用外部 OIDC IdP 登录」作为**追加**方式;密码路径不受影响,未配 IdP 时 SSO 隐藏。

**目标:** 配齐 OIDC env 后,登录页出现「用 SSO 登录」;走 OAuth2 授权码流(redirect → callback → 换 token → userinfo → 映射/建本地用户 → 签发本平台 session cookie)。

**架构:** `server/oidc.ts`(配置 + discovery + 授权码流 + state 存储,**fetch 可注入**以单测)+ `users.oauth_sub` 列 + `upsertOidcUser` + 3 条路由 + 前端 SSO 按钮。无新依赖(用 Bun `fetch`)。

**分支:** `main`。**约束:** 无真实 IdP,逻辑靠注入 mock 单测;不做真 IdP 端到端实跑。

---

## F3.1 配置(env;`server/oidc.ts`)

- `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_REDIRECT_URI`。
- `ssoEnabled()` = 四者皆非空。未启用时:`/api/auth/config` 返回 `{ sso: false }`,login/callback 路由返回 404/400,前端隐藏按钮。

## F3.2 OIDC 客户端 `server/oidc.ts`(fetch 可注入)

- `discover(fetchImpl?)`:GET `${ISSUER}/.well-known/openid-configuration` → `{authorization_endpoint, token_endpoint, userinfo_endpoint}`;模块内缓存(首次拉,后续复用)。
- `buildAuthUrl(state)`:`authorization_endpoint?response_type=code&client_id=…&redirect_uri=…&scope=openid email profile&state=…`。
- `exchangeCode(code, fetchImpl?)`:POST `token_endpoint`(`grant_type=authorization_code` + code + redirect_uri + client_id/secret,`application/x-www-form-urlencoded`)→ `{ access_token }`。
- `fetchUserInfo(accessToken, fetchImpl?)`:GET `userinfo_endpoint`(Bearer)→ `{ sub, email?, preferred_username? }`。
- **state 存储**:模块内 `Map<state, expiresAt>`;`issueState()` 生成随机 state + 存(TTL 10 分钟);`consumeState(state)` 校验存在且未过期后删除(一次性)。单进程内存即可。
- 全部对外函数接受可选 `fetchImpl`(默认全局 `fetch`)→ 单测注入 mock。`discover` 缓存可重置(测试用 `__resetDiscoveryCache()`)。

## F3.3 用户映射(`server/db.ts`)

- migrate:`users` 加 `oauth_sub TEXT`(`PRAGMA table_info` 检测);`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_sub ON users(oauth_sub) WHERE oauth_sub IS NOT NULL`。
- `upsertOidcUser(db, sub, preferredName): { id, username }`:
  - 先按 `oauth_sub = sub` 找 → 命中返回。
  - 否则建号:username = `preferredName` 去空白;若 username 已被占用,加后缀 `-2`/`-3`…;`password_hash = ""`(SSO-only,密码登录因 verify("",…) 永远 false 而拒);`oauth_sub = sub`。返回新用户。

## F3.4 路由(`server/index.ts`,均在 session 中间件**之前**=免鉴权)

- `GET /api/auth/config`(公开)→ `{ sso: ssoEnabled() }`。
- `GET /api/auth/oidc/login`:未启用 → 404;否则 `issueState()` → 302 `Location: buildAuthUrl(state)`。
- `GET /api/auth/oidc/callback?code&state`:未启用 → 404;`consumeState(state)` 失败 → 400;`exchangeCode(code)` → `fetchUserInfo` → `upsertOidcUser(db, sub, preferred_username||email||sub)` → `createSession` → `Set-Cookie` + 302 回 `/`(失败 → 302 回 `/?sso_error=1` 或返回 400 文本)。

## F3.5 前端

- `src/api/client.ts`:`auth.config = () => GET /api/auth/config`。
- `src/components/Login.tsx`:挂载查 `auth.config()`;`sso` 为真则在密码表单下显示「用 SSO 登录」按钮 → `window.location.href = "/api/auth/oidc/login"`。回调成功后浏览器落回 `/`,`App` 的 `me()` 命中 → 进面板。

## F3.6 安全 / 边界

- `state` 防 CSRF + 一次性 + TTL。
- 用 **userinfo** 取身份(不验 id_token 签名):走 TLS、信任配置的 IdP;MVP 取舍(非目标:JWKS 验签)。
- SSO 用户无密码(`password_hash=""`)→ 不能密码登录;username 冲突自动加后缀(不并入已有密码账号——本期按 `sub` 独立建号)。
- env 未配 → SSO 全链路关闭,D1 密码路径零影响。
- 回调失败(换 token/userinfo 报错)→ 不建会话,导回登录页带错误提示。

## F3.7 测试(无真实 IdP)

- `oidc.test.ts`:注入 mock fetchImpl —— `discover` 解析 .well-known + 缓存;`exchangeCode` 解析 token;`fetchUserInfo` 解析 sub/email;`issueState`/`consumeState`(一次性 + 过期返回 false);`ssoEnabled` 按 env。
- `db.test.ts`:`upsertOidcUser` —— 首次建号(oauth_sub 落库)、同 sub 复用、username 冲突加后缀。
- `server.integration.test.ts`:用 `buildServer` + 注入 mock OIDC(把 oidc 的 fetchImpl/exchange/userinfo 换成桩),走 `GET /oidc/callback?code=ok&state=<issued>` → 断言 Set-Cookie + 302、`me()` 可用;坏 state → 400;`GET /api/auth/config` 在 env 有/无时 sso true/false;**密码注册/登录回归仍绿**。
- 前端:tsc + 浏览器(env 未配时无 SSO 按钮、密码登录照常;配置态因无真实 IdP 不端到端)。

## 完成判据

- env 配齐:`/api/auth/config` `sso:true`、登录页有 SSO 按钮、`/oidc/login` 302 到 IdP、callback(mock 覆盖)建号/复用并签发 cookie。
- env 未配:`sso:false`、无按钮、`/oidc/*` 关闭、密码登录/隔离/团队全部照常。
- `bun test` 全绿(现有 88 + oidc/db/集成);`tsc` 干净;`bun run build` 成功。
