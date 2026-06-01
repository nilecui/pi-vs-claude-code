# coms-dashboard — 自托管多用户多 Agent 编排平台

把多个真实 Pi agent 的协作,做成一个**可配置、可持久化、多用户**的 Web 平台:浏览器里自助创建编排场景 → 服务端真实驱动多个 agent 协作 → 流式看产出 → 历史回看/重跑,数据按用户/团队隔离。

> 定位:**自托管单主机多用户**。Agent 是真实 `pi` TUI 进程(coms-net hub + tmux/PTY),平台负责账号、编排、持久化与可视化。

---

## 架构

```
浏览器(React + Vite, :5273)
   │  /api  → 后端(REST + 每-run SSE)
   │  /v1   → hub(只读观察:关系图 / 终端条)
   ▼
后端 server/(Bun, :5274)
   ├─ 会话鉴权中间件(httpOnly cookie)
   ├─ SQLite(bun:sqlite):users/sessions/teams/team_members/scenarios/runs/run_steps
   ├─ 服务端编排引擎(复用 src/lib/orchestration 的纯解释器)
   ├─ hub 客户端(注册+心跳+SSE,按 msg_id 关联回复)
   └─ agent spawner(tmux 起 pi 进程)
   ▼
coms-net hub(独立 pi 进程, :49840) ── 真实 pi agents(gpt-5.5 / MiniMax …)
```

**关键设计:编排是「数据」不是「代码」。** 一个场景 = 一份 `ScenarioDef`(角色 + 步骤 DAG + prompt 模板 + 装配模板),由通用解释器执行;新增场景 = 改数据(或用编辑器),无需写代码。编排在**服务端**运行,运行不随浏览器关闭而中断、可多端观察。

---

## 子系统(均经 spec → plan → 实现 → 测试 → 实跑验证)

| | 子系统 | 内容 |
|---|---|---|
| A | 配置驱动编排内核 | `src/lib/orchestration/`:`ScenarioDef` 模型 + 模板引擎 + 校验器(含传递依赖/环检测)+ 拓扑解释器(并发限流、超时传播、无损装配) |
| B | 后端 + 持久化 + 服务端编排 | `server/`:Bun API + SQLite + hub 客户端 + run 引擎 + 每-run SSE;前端薄客户端 |
| C | 场景编辑器 UI | 表单式建/改场景(角色、步骤、依赖 chip、prompt、可见性),实时复用 A 的校验 |
| E | 运行历史 / 产出库 | 历史列表 + 重看步骤/装配产出 + 重跑 |
| D1 | 账号 + 归属隔离 | 注册/登录/会话;scenarios/runs 按 owner 隔离;内置场景全员只读 |
| D2 | 团队 + 共享 | 团队(owner 按用户名加成员);场景可见性 私有/团队;团队场景成员只读可复制 |
| + | 并发上限 | 就绪批次 `mapLimit`(默认 6),宽扇出排队不洪峰;`ScenarioDef.maxConcurrency` 可调 |

---

## 运行

三个常驻服务(仓库根目录):

```bash
# 1) 消息中枢 hub(开 firehose 才能看 agent↔agent)
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server

# 2) 后端:API + SQLite + 服务端编排 + spawn(取代旧 spawner)
just server          # 127.0.0.1:5274;跨机多用户可设 COMS_SERVER_HOST=0.0.0.0

# 3) 前端
cd apps/coms-dashboard && bun install && bun run dev   # http://localhost:5273
```

模型凭证:Codex 订阅(`pi` 内 `/login` 选 ChatGPT Codex,免 key,`--provider openai-codex --model gpt-5.5`)/ MiniMax(仓库根 `.env` 里 `MINIMAX_API_KEY`)。

**首次使用**:打开 `:5273` → 登录页 →「去注册」自助创建账号(开放注册;各账号数据隔离)。SQLite 落在 `server/data/coms.db`(gitignored);重启后端会把残留 running 的 run 标为 aborted。

---

## `ScenarioDef`(配置即编排)

```jsonc
{
  "id": "bid", "title": "标书制作", "blurb": "并行派写作 → 合规校验 → 整合",
  "roles": [{ "name": "tech-writer", "provider": "openai-codex", "model": "gpt-5.5", "purpose": "技术方案", "color": "#10b981" }],
  "input": { "label": "粘贴 RFP…", "default": "…" },
  "steps": [
    { "id": "tech", "role": "tech-writer", "prompt": "…{{input}}", "after": [] },
    { "id": "comp", "role": "compliance", "prompt": "校验…{{steps.tech}}", "after": ["tech"] }
  ],
  "assembly": "# 投标文件\n{{steps.comp}}",
  "maxConcurrency": 6
}
```
- `prompt`/`assembly` 模板:`{{input}}`、`{{steps.<id>}}`。
- 解释器按 `after` 拓扑执行;就绪批次并发(≤ `maxConcurrency`);每步追加「禁止转发」指令(防 agent 互等死锁);`assembly` **无损拼接**各步真实产出。
- 内置 3 场景:`hierarchy`(层级演示)、`bid`(标书)、`contract`(合同审查)。

---

## API 速览(全部 `/api/*` 需会话 cookie,除 `auth/*` 与 `health`)

- 鉴权:`POST /api/auth/{register,login,logout}`、`GET /api/auth/me`
- 场景:`GET/POST /api/scenarios`、`GET/PUT/DELETE /api/scenarios/:id`、`POST /api/scenarios/:id/duplicate`(POST/PUT 体可带 `teamId`)
- 运行:`POST /api/runs {scenarioId,input}`、`GET /api/runs[?scenarioId=]`、`GET /api/runs/:id`、`GET /api/runs/:id/events`(SSE)
- 团队:`GET/POST /api/teams`、`GET/DELETE /api/teams/:id`、`POST /api/teams/:id/members`、`DELETE /api/teams/:id/members/:userId`
- agent:`GET /api/agents`、`POST /api/agents/{spawn,kill}`(及向后兼容 `/spawn /list /kill`)

数据隔离:`scenarios` 可见 = 本人 ∪ 内置(owner NULL)∪ 我所属团队;改/删仅 owner。`runs` 仅 owner。

前端仍直连 hub `/v1`(经 Vite 代理注入 token)**只读观察**——关系图(AntV G6)与顶部终端条;编排消息一律走后端 `/api`。

---

## 测试

```bash
cd apps/coms-dashboard && bun test          # 81 单测(纯逻辑 + 后端 + 集成)
bunx tsc --noEmit && bun run build          # 类型 + 构建
```
纯逻辑(模板/校验/解释器/草稿/auth/teams/db)单测;后端起内存 sqlite + mock hub 做集成(登录→鉴权→隔离→编排落库→SSE)。前端组件靠 tsc + 浏览器验收。

设计与实现计划见 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`(每个子系统一份)。

## Stack

React 18 + Vite + TypeScript + Zustand;AntV G6(关系图);react-markdown(产出渲染);后端 Bun(`Bun.serve` + `bun:sqlite` + `Bun.password`),无重型框架;`bun test`。
