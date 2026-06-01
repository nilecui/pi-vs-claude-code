# 运行历史 / 产出库 UI(子项目 E)设计

> 平台第四块(建造顺序 A→B→C→E→D)。承接 B 的运行持久化(`GET /api/runs`、`GET /api/runs/:id`)。给历史运行做界面:浏览、重看产出/步骤、重跑。

**目标:** 在 dashboard 加运行历史界面 —— 列出当前场景的历史运行,点开重看装配产出与各步骤,支持用旧输入重跑。

**架构:** 一个左右分栏模态 `RunHistory.tsx`(列表 + 详情,纯读 `/api/runs`)+ ScenarioChat 接线(「历史」入口 + 把 `run()` 抽成 `runWith(text)` 供重跑复用)。后端零改动。

**技术栈:** React 18 + TS + Vite;复用 `src/api/client`(`listRuns`/`getRun`)、react-markdown。无新增依赖。

**分支:** `coms-dashboard-terminals`(A+B+C 已完成)。

---

## E.1 入口与位置

- `ScenarioChat` 头部新增 **「历史」** 按钮(与 `+ 新建`/`编辑`/`查看产出` 同排)。
- 点击打开 `RunHistory` 覆盖层模态,展示**当前选中场景**(`sid`)的历史运行。
- 不改三栏布局;模态层叠样式 `.history-*`(与 `.editor-*`/`.result-*` 同族)。

## E.2 组件 `RunHistory.tsx`

Props:`{ scenarioId: string; onRerun: (input: string) => void; onClose: () => void }`。

- 打开时 `api.listRuns(scenarioId)` → 左栏列表(倒序):每条显示
  - 相对/绝对时间(由 `created_at` 毫秒时间戳格式化);
  - 状态药丸:`done`(绿)/`error`(红)/`aborted`(灰)/`running`(蓝);
  - `input` 摘要(单行截断)。
- 选中某条 → `api.getRun(id)` → 右栏:
  - **步骤区**:每个 step 一行(`step_id` · `role` · 状态),展开显示 `output`(静态,`<pre>`/小字)。
  - **装配产出**:`result_md` 用 `ReactMarkdown`(+remark-gfm)**静态渲染**(非打字机);顶部「复制全文」。
  - 若 `result_md` 为空(error/aborted/无产出)→ 显示状态说明。
- 每条 run(列表项或详情头)有 **「重跑」** 按钮 → `onRerun(run.input)`。
- 空列表 → 「本场景暂无运行记录」。

## E.3 ScenarioChat 接线

- 新增 `showHistory` state + 头部「历史」按钮(`disabled` 当无 `sid`)。
- 渲染 `{showHistory && <RunHistory scenarioId={sid} onRerun={rerun} onClose={()=>setShowHistory(false)} />}`。
- **抽取 `runWith(text: string)`**:把现有 `run()` 的主体改为接收明确输入;`run()` 调 `runWith(draft.trim())`。
- `rerun(input)`:`setShowHistory(false); setDraft(input); runWith(input);`(复用现有 SSE 实时渲染路径)。

## E.4 client / 后端

- 复用 `api.listRuns(scenarioId)`、`api.getRun(id)`(B 已实现,返回 `{run:{...,steps:[]}}`)。**无新增 API、后端零改动。**

## E.5 数据流

```
[历史] → api.listRuns(sid) → 左栏列表
  选 run → api.getRun(id) → 右栏(步骤 + result_md 渲染 + 复制)
  [重跑] → onRerun(run.input) → ScenarioChat.runWith(input) → POST /api/runs + SSE 实时
```

## E.6 样式 `.history-*`

左右分栏模态:左 run 列表(可滚动、选中高亮、状态药丸),右详情(步骤 + Markdown 产出)。复用现有 token 与模态层叠(backdrop/modal/head/close/copy)。

## E.7 错误处理 / 边界

- `listRuns`/`getRun` 失败 → 模态内提示「加载失败」。
- 空历史 → 占位文案。
- 重跑前 ScenarioChat 已确保 `sid` 对应场景存在(场景被删则下拉已不含;历史按 scenarioId 查,过期场景的历史仍可看但重跑会 404 → 提示)。

## E.8 测试

- E 是薄读取 UI;数据层 `/api/runs`/`/api/runs/:id` 已在 B 的 db/集成测试覆盖。
- 本期验证:`tsc` + `bun run build` + 浏览器人工验收(下方完成判据)。
- 无值得抽取的纯逻辑(仅时间/状态文案映射,价值低,内联即可)。

## E.9 非目标

- 删除 run(留待补后端 `DELETE /api/runs/:id`);跨场景全局历史(本期按当前场景);分页(历史量大时再加);账号过滤(D)。

## 完成判据

- 对某场景跑过 ≥1 次后点「历史」→ 看到运行列表(时间/状态/输入摘要)。
- 点开一条 → 右栏重看各步骤产出 + 装配全文(Markdown)+ 可复制。
- 点「重跑」→ 关闭历史、用该 run 的旧输入**重新真实运行**并在主聊天区 SSE 实时显示。
- `tsc` 干净;`bun run build` 成功;现有 61 测试仍全绿。
