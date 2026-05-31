# coms-dashboard 重设计 — 设计文档

**日期**: 2026-05-31
**范围**: `apps/coms-dashboard`(coms-net agent 控制面板)的视图层重设计
**状态**: 设计已确认,待写实现计划

---

## 1. 背景与目标

`apps/coms-dashboard` 是 coms-net agent hub 的 Web 控制面板:观察 agent 池、向 agent 发消息、用关系图展示流量。当前版本已套用 AI-Employee 浅色设计系统(见 `src/styles.css`)。

本次重设计**只动视图层**,数据层(`store.ts` 的 SSE 事件流、`api/hub.ts` 客户端、`types.ts` 协议)保持不变。目标:

1. 左栏能「加 agent」,表单清晰。
2. agent flow 图更好看 —— 改用 **AntV G6**(内置动画关系网)。
3. 点击节点可显示/设置。
4. 每个 agent 的日志看板放右栏,做成可折叠列表,点节点自动跳转。
5. agent 之间能相互交互(在面板里发起)。
6. 呈现 agent 设计模式(4 种)并映射为图布局预设。

### 关键约束(已核实)

- **浏览器无法拉起 Pi 进程**;**hub 只转发消息,不 spawn agent**(`scripts/coms-net-server.ts` 无 spawn 路由)。→ 「加 agent」采用**命令生成器**,不引入后端。
- agent 是独立 Pi 进程,真正的动作由其本人执行。→ 「互发」采用**编排式**(提示 A 去联系 B),不做身份冒充。

---

## 2. 已确认的决策

| 决策点 | 选择 |
|---|---|
| 整体布局 | **A · 三栏常驻**:左 agent 列表+加号表单 / 中 G6 flow / 右可折叠日志手风琴 |
| flow 图库 | **AntV G6 v5**(配置式节点,移除 reactflow) |
| 加 agent 机制 | **生成启动命令**(纯前端,零后端) |
| agent 互发 | **编排式**:面板给 A 发 prompt 让 A 用 coms 工具联系 B |
| 节点点击面板 | 查看详情 + 跳转聚焦日志 + 直接发消息 + 发起 peer 对话(全部) |
| agent 设计模式 | 4 种;默认 peer-to-peer 力导向,其余作可切换视角预设 |

---

## 3. 布局

```
┌─────────────┬──────────────────────────┬──────────────┐
│ 左栏 ~280px  │   中栏 flow (G6, flex)     │ 右栏 ~320px   │
│             │                          │ 可折叠日志    │
│ + Add Agent │   ◆panel ─── alice       │ ▾ alice [log]│
│ (命令生成)   │      ╲   ╱   ╲           │ ▸ bob        │
│             │       bob   carol        │ ▸ carol      │
│ agent 列表   │   [视角预设: force ▾]     │ ─ activity   │
└─────────────┴──────────────────────────┴──────────────┘
   点节点 → 选中 + 右栏自动展开&滚动到它 + 弹节点面板
```

`App.tsx` 用 CSS grid 三列:`grid-template-columns: 280px 1fr 320px`。沿用现浅色设计系统 token。

---

## 4. 组件拆分(`src/components/`)

每个组件单一职责、通过 store 通信、可独立理解与测试。

| 组件 | 职责 | 依赖 |
|---|---|---|
| `App.tsx` | 三栏 grid 骨架,装配三个区域 | store |
| `AddAgentForm.tsx` | 命令生成器(见 §5):表单 → 预览命令 + 复制 | `lib/launchCommand.ts` |
| `AgentList.tsx` | 左栏 agent 卡片列表,点击=选中+聚焦其日志 | store |
| `FlowGraph.tsx` | G6 关系图(见 §6):配置节点、力导向、动画边、预设切换、节点点击 | `@antv/g6`, store |
| `NodePanel.tsx` | 节点点击弹出(见 §7):详情/跳转日志/发消息/发起 peer 对话 | store, `InteractionComposer` |
| `LogRail.tsx` | 右栏手风琴(每 agent 一段可折叠)+ 全局 activity;选中时自动展开+滚动 | 复用 `TerminalCard` |
| `InteractionComposer.tsx` | From→To→任务 的编排式互发表单 | store |

保留:`TerminalCard.tsx`(作为日志段落正文)、`styles.css`(扩展新区域样式)。
移除:`Sidebar.tsx`(拆成 `AddAgentForm` + `AgentList`)、`GraphView.tsx`(被 `FlowGraph` 取代)。

---

## 5. AddAgentForm — 加 agent(命令生成器)

`lib/launchCommand.ts` 是纯函数:表单值 → 命令字符串。表单不碰 hub。

### 参数(已对 `extensions/coms-net.ts` + justfile 核实)

| 字段 | 生成 | 来源层 | 备注 |
|---|---|---|---|
| **name** *(必填,池内唯一)* | `--name alice` | coms-net flag | peer 寻址用 |
| **模型预设** *(下拉)* | `--provider openai --model gpt-5.5` | Pi 核心 flag | 预设见下;选「自定义」手填 |
| **purpose** *(选填)* | `--purpose "…"` | coms-net flag | 否则取 frontmatter |
| **color** *(选填)* | `--color "#10b981"` | coms-net flag | 不填用调色板 fallback |
| **project** *(选填,默认 default)* | `--project default` | coms-net flag | hub 命名空间 |
| **explicit** *(勾选)* | `--explicit` | coms-net flag | 隐藏 agent,精确名寻址 |
| **工作目录** *(选填)* | 前缀 `cd <dir> &&` | 进程 cwd | 非 flag |

**模型预设**(来自 justfile coms1–4):`gpt-5.5`(openai)/ `claude-opus-4-7` / `deepseek/deepseek-v4-pro` / `z-ai/glm-5.1` / 自定义(provider+model 手填)。

**自动发现、不入表单**:`--server-url` / `--auth-token`(从 `server.json` / `server.secret.json` 读)。

### 输出

```bash
just coms --name alice --provider openai --model gpt-5.5 \
  --color "#10b981" --purpose "Prod gatekeeper, never leak PII"
# 指定工作目录:
cd /path/to/work && just coms --name alice --provider openai --model gpt-5.5 …
```

- `just coms` = `pi -e extensions/coms-net.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts {{args}}`,需在仓库根目录运行。
- 提供切换:**「裸 `pi -e …` 形式」**(扩展用绝对路径),可在任意目录运行。
- 「复制」按钮:`navigator.clipboard.writeText`,失败兜底为选中命令文本。
- 校验:name 必填且不与现有 agent 重名;color 为合法 hex。

---

## 6. FlowGraph — AntV G6 关系图

- **库**: `@antv/g6@^5`。挂载到容器 div,React 用 `useEffect` 管理 Graph 生命周期(create/destroy),用 ref 持有实例;数据变化时 `graph.setData` + 重新布局。
- **节点**: 配置式自定义节点,复刻浅色设计系统卡片观感(名字、model、状态色边框、ctx% 进度、queue)。`__dashboard__` 节点特殊样式(◆ control panel)。
- **状态映射**: online 正常,stale 降透明,offline 更淡。
- **边**:
  - 静息:panel↔各 agent 的细灰边(`#e2e8f0`)。
  - 消息脉冲:读 `store.flows`,prompt=蓝 `#3b82f6` / response=绿 `#10b981` / error=红 `#ef4444`,用 G6 边动画(流光/running-line),2.4s 后随 flow 回收。
- **布局预设(对应 4 种模式)**:右上角下拉切换,仅改摆位,不动 hub 行为。
  - `force` 力导向 — **peer-to-peer(默认)**
  - `dagre`(左→右)— chain / DAG
  - `radial`(枢纽居中)— broker
  - `compactBox`/`dendrogram` tree — subagent
- **交互**: `graph.on('node:click')` → `store.select(id)`(触发右栏聚焦)+ 打开 `NodePanel`;支持缩放/拖拽/fitView。

---

## 7. NodePanel — 节点点击面板

点击节点(非 panel)弹出(浮层或贴边小面板),含 4 项能力:

1. **查看详情**: name / model / provider / purpose / cwd / project / ctx% / queue / status / 在线时长。
2. **跳转并聚焦日志**: 触发右栏对应段 expand + `scrollIntoView`(等价于 `select`)。
3. **直接发消息**: 内嵌输入框,panel → 该 agent 发 prompt(复用 `store.send`)。
4. **发起与其他 agent 的对话**: 内嵌 `InteractionComposer`,From=当前节点,选 To,填任务。

---

## 8. LogRail — 右栏可折叠日志

- 手风琴:每个 agent 一段(头部=名字+状态点+chevron,正文=`TerminalCard`),可独立折叠。
- 底部固定一段「activity feed」(全局 `store.lines`)。
- **聚焦联动**: 监听 `store.selected`,自动展开对应段并 `scrollIntoView({ behavior: 'smooth', block: 'start' })`。
- 折叠状态本地维护(`useState` Record<sessionId, boolean>)。

---

## 9. 状态层改动(`store.ts`,增量)

- 复用现有 `selected` 作为「聚焦信号」:`select(id)` 既高亮节点又驱动右栏展开/滚动(LogRail 监听)。
- 新增 `orchestrate(fromName, toName, task)`:
  - 复用 `client.send(fromName, prompt)`,其中 prompt 为模板:
    > `请用你的 coms 工具联系 {toName},转达/协作:{task}。完成后直接给我结论,不要与对方无限往返(避免死循环)。`
  - 同时 `pulse(fromSession, toSession, "prompt")` 在图上画预期边。
  - 模板透传 `hops`,防文档第六节提到的「套娃死循环」。
- `AddAgentForm` 状态纯本地,不进 store。

---

## 10. 边界与风险

- **无 agent**: 空状态引导「+ Add Agent」。
- **剪贴板失败**: 兜底为选中命令文本 + 提示手动复制。
- **G6 布局抖动**: agent 增删后 force 收敛(tick 结束)再 `fitView`;切预设时平滑过渡。
- **脉冲回收**: 沿用现 2.4s `clearFlow`。
- **死循环防护**: 编排 prompt 内置终止约束 + hops 透传。
- **G6 内存**: 组件卸载时 `graph.destroy()`。

---

## 11. 测试

- **纯函数单测**(bun test):
  - `lib/launchCommand.ts` — 各字段组合 → 命令字符串(含 cd 前缀、裸 pi 形式、引号转义)。
  - `orchestratePrompt(from, to, task)` — 模板拼接。
- **交互验证**(浏览器实跑,沿用上次 computed-style/DOM 断言方式):
  - G6 渲染节点/边、布局预设切换。
  - 点节点 → 右栏对应段展开并滚动到位。
  - 命令生成与复制。
  - 空状态。

---

## 12. 依赖变更

- 新增: `@antv/g6@^5`
- 移除: `reactflow`

---

## 13. 不在本次范围(YAGNI)

- 真正 spawn agent 的后端 sidecar(本次只生成命令)。
- 身份冒充式 agent 互发。
- 日志虚拟滚动(现 `MAX_LINES=500` 足够)。
- 持久化布局/折叠偏好。
