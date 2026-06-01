# 后端 API + SQLite 持久化 + 服务端编排(子项目 B)设计

> 平台第二块。承接子项目 A(配置驱动编排内核,纯 TS 解释器已就绪)。把编排从浏览器移到服务端,加持久化与 API。整体平台分解见 `2026-06-01-config-driven-orchestration-core-design.md` 的「平台背景」。

**目标:** 新增一个自托管后端服务,**在服务端运行编排**(复用 A 的 `runScenario`),把场景、运行记录、装配产出落 SQLite,并通过 REST + SSE 暴露给前端;前端退化为薄客户端。

**架构:** 单一 Bun 服务 `apps/coms-dashboard/server/`,吸收现有 spawner 职责,内置 hub 客户端,跑服务端解释器,SQLite(bun:sqlite)持久化,REST + 每-run 的 SSE。前端通过 `/api` 读场景、起运行、订阅 run 事件。

**技术栈:** Bun(`Bun.serve`、`bun:sqlite`)、TypeScript、`bun test`;前端 React 18 + Zustand + Vite(现状)。不引入重型框架(裸 `Bun.serve` 路由)。

**定位:** 自托管单主机多用户;账号/权限留待子项目 D,本阶段仍绑定 `127.0.0.1`。

---

## B.1 服务形态与边界

- 新服务目录 `apps/coms-dashboard/server/`,入口 `server/index.ts`,`Bun.serve` 监听端口 **5274**(接管原 spawner 端口;原 `scripts/agent-spawner.ts` 的 spawn 逻辑迁入 `server/agents.ts`)。
- 启动命令:`just server`(替换 `just spawner`)。运行从「hub + spawner + dev」三件套 → 「hub + server + dev」(dev 仅前端热更)。
- 职责:① REST + SSE API;② SQLite 持久化;③ 内置 hub 客户端(发消息、收响应);④ 服务端运行引擎(跑 `runScenario`);⑤ spawn / kill / list agent。
- 不动:hub 仍是独立 pi 进程(`just coms-net-server`)。Vite 代理:`/api` → backend(新增);`/v1` → hub(保留,供前端只读观察关系图/终端条);`/spawner` 兼容别名 → backend(或前端全面改用 `/api`)。
- **复用 A**:`server/` 直接 `import` `apps/coms-dashboard/src/lib/orchestration/{runScenario,validate,types}`(同仓库 TS,Bun 可直接执行)。`scenarios.ts` 的 `SCENARIOS` 仅作 seed 源。

## B.2 数据模型(bun:sqlite,WAL 模式)

DB 文件:`apps/coms-dashboard/server/data/coms.db`(目录 gitignore)。

```sql
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  blurb TEXT NOT NULL,
  data TEXT NOT NULL,            -- 完整 ScenarioDef 的 JSON
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL,          -- running | done | error | aborted
  result_md TEXT,               -- 装配后的完整产出(完成后写入)
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE run_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,          -- pending | running | done | error | timeout
  output TEXT,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX idx_runs_scenario ON runs(scenario_id);
CREATE INDEX idx_run_steps_run ON run_steps(run_id);
```

- **Seed:** 首次启动(scenarios 表为空时)把 A 的 `SCENARIOS` 三个内置写入(`builtin=1`)。
- DB 层封装在 `server/db.ts`,导出纯函数(`listScenarios`/`getScenario`/`upsertScenario`/`deleteScenario`/`createRun`/`updateRunStatus`/`upsertRunStep`/`getRun`/`listRuns`),接受一个 `Database` 实例(便于测试用临时库)。

## B.3 API(REST + SSE)

全部挂在 `/api`,JSON。

| 方法 路径 | 行为 |
|---|---|
| `GET /api/scenarios` | 列出场景(id/title/blurb/builtin) |
| `GET /api/scenarios/:id` | 取完整 ScenarioDef |
| `POST /api/scenarios` | 新建(body=ScenarioDef);先 `validate`,失败 400 返回错误列表 |
| `PUT /api/scenarios/:id` | 更新;先 `validate`;`builtin=1` 拒绝(409,提示先 duplicate 再改) |
| `DELETE /api/scenarios/:id` | 删除;`builtin=1` 拒绝(409),提示「复制后再改」 |
| `POST /api/scenarios/:id/duplicate` | 复制为新 id(用于基于内置改) |
| `POST /api/runs` | body `{scenarioId, input}`;创建 run(status=running)、**异步启动服务端编排**、立即返回 `{runId}` |
| `GET /api/runs?scenarioId=` | 运行历史(倒序) |
| `GET /api/runs/:id` | run 详情:runs 行 + 其 run_steps + result_md |
| `GET /api/runs/:id/events` | **SSE**:推送该 run 的 `step`(step_id/role/status/output)、`status`、`result`、`done` 事件;新订阅者先收一份当前快照再续推 |
| `POST /api/agents/spawn` / `POST /api/agents/kill` / `GET /api/agents` | 吸收原 spawner 接口 |

CORS:仅本机,沿用现有 `Access-Control-Allow-Origin`(后续 D 收紧)。

## B.4 服务端运行引擎(把 A 接到后端)

`server/hubClient.ts`:
- 注册到 hub(沿用前端 `src/api/hub.ts` 的协议:`/v1/agents` 注册、`/v1/messages` 发送、`/v1/events` SSE 监听),token 自动发现(`~/.pi/coms-net/projects/default/server.secret.json`,与现有逻辑一致)。
- `send(role, prompt): Promise<string>` 返回 msg_id;内部维护「msg_id → 等待中的 resolver」,SSE 收到 `response`/`error` 事件按 msg_id resolve。
- 暴露 `ask(role, prompt, timeoutMs): Promise<string>`(超时 resolve `TIMEOUT_TEXT`,与 A 对齐)。

`server/runner.ts`:
- `startRun(db, hub, scenario, input, broadcast)`:
  - `createRun` 落库(running);
  - 调 A 的 `runScenario(scenario, input, deps)`,其中
    - `ask` = hubClient.ask;
    - `spawnMissing` = `server/agents.ts` 的 spawn + 轮询 hub `/v1/agents` 注册;
    - `onStepUpdate(id,status,text)` → `upsertRunStep` 落库 + `broadcast({type:'step',...})`;
    - `onStatus(msg)` → `broadcast({type:'status', msg})`;
    - `onResult(md)` → `updateRunStatus(done, result_md=md)` + `broadcast({type:'result', md})` + `broadcast({type:'done'})`;
  - 捕获异常 → `updateRunStatus(error)` + broadcast。
- `server/runHub.ts`:每个 runId 维护订阅者集合(SSE writers),`broadcast` fan-out;新订阅先发快照(从 DB 读当前 steps/status)再续推。

## B.5 前端迁移(B2)

- `src/api/client.ts`(新):`getScenarios()`/`getScenario(id)`/`createRun(scenarioId,input)`/`runEvents(runId)`(返回 `EventSource`)/`listRuns`/scenario CRUD。
- `ScenarioChat.tsx`:
  - 场景下拉 ← `getScenarios()`(不再静态 import `SCENARIOS`);选中时 `getScenario` 取详情供展示。
  - 运行 ← `createRun` → `new EventSource('/api/runs/:id/events')`;按 `step`/`status`/`result` 事件渲染分派/气泡/状态/产出。
  - **删除**浏览器内的 `ask`/`spawnMissing`/`runScenario` 调用。
- `store.ts`:编排相关的 `send`(对 hub 发编排消息)从前端移除;**保留**对 hub 的只读 SSE 观察(关系图 `FlowGraph`、终端条仍直接看 hub),所以前端仍连 hub 只读。
- `spawnMissing`/`stop` 改调 `/api/agents/*`。
- A 的 `src/lib/orchestration/scenarios.ts` 不再被前端 import(仅后端 seed 用);保留文件。

## B.6 错误处理 / 边界

- agent 超时/出错:A 的引擎已分别置 `timeout`/`error` 并继续下游;后端落库 + SSE 通知;run 最终 `done`(含占位符产出)或 `error`(引擎抛出)。
- **后端重启**:启动时把残留 `status=running` 的 runs 批量改为 `aborted`(无法恢复内存中的 in-flight 编排)。
- 并发:SQLite 开 `PRAGMA journal_mode=WAL`;run 的写入在单进程内天然串行(Bun 单线程事件循环)。
- 安全:绑定 `127.0.0.1`;token 不出后端(前端经 Vite 代理,不再需要 hub token —— 编排已在后端;前端只读 hub 仍走现有代理注入)。

## B.7 测试(bun test)

- `db.test.ts`:用临时/内存 sqlite —— scenario CRUD、builtin 删除拒绝、seed 幂等、run + steps 读写。
- `hubClient.test.ts`:mock SSE 流 —— `ask` 按 msg_id 正确 resolve、超时返回 `TIMEOUT_TEXT`、不同 msg_id 不串。
- `runner.test.ts`:mock hub(`ask` 返回固定值)+ 内存 db —— `startRun` 跑一个 2~3 步场景,断言:run_steps 落库顺序/状态、broadcast 事件序列(step×N → result → done)、runs.result_md 等于装配结果。
- 集成 `server.integration.test.ts`:起 `Bun.serve`(随机端口 + 临时 db + mock hubClient)→ `POST /api/runs` → 连 SSE → 断言收到 step/result/done → `GET /api/runs/:id` 落库正确。
- 前端迁移(B2)以现有手动浏览器验证 + tsc 为主(无组件单测框架)。

## B.8 实现分两阶段(两个 plan)

- **B1 · 后端**:`server/{index,db,hubClient,agents,runner,runHub}.ts` + 上述单测/集成测试 + justfile `server` 任务 + Vite 代理 `/api`。交付:`POST /api/runs` 能在服务端真实编排并落库,SSE 推全程,`bun test server/` 全绿。
- **B2 · 前端迁移**:`src/api/client.ts` + 改 `ScenarioChat`/`store` 走 API/SSE,删浏览器编排;启动应用人工验证(行为与 A 末态一致,但运行可刷新存活、历史可见)。

## 非目标

- 账号 / 多租户 / 权限 / 鉴权(子项目 D)。
- 可视化场景编辑器(子项目 C;B 仅提供 scenario CRUD API + 现有下拉,新建/编辑 UI 留 C)。
- 精细运行历史 UI(子项目 E;B 提供 `runs` API + 基础「历史」入口即可)。
- 多机 / 容器化部署(自托管单主机之外)。

## 完成判据

- `just server` 起单一后端;首启 seed 3 内置场景入库。
- 浏览器选场景 → 运行:**编排在后端跑**,前端经 SSE 看到分派/各角色产出/装配产出,与 A 末态视觉一致。
- **关掉浏览器再打开,运行记录与产出仍在**(从 DB / runs API 恢复);多标签订阅同一 run 都能看到。
- 新建一个纯数据场景(`POST /api/scenarios`)即可在下拉出现并运行。
- `bun test server/` 全绿;`tsc` 干净。
