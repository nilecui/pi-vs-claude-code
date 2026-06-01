# 可视化 DAG 预览(子项目 F2)设计

> 承接 C(表单式 `ScenarioEditor`)与 A(`ScenarioDef`)。在表单编辑器里加一块实时的只读 DAG 图,让用户看清步骤依赖结构并快速定位。**起步形态**;全拖拽建图(reactflow)留作以后升级。

**目标:** 编辑场景时,顶部嵌一块自动布局的只读 DAG(节点=步骤、边=`after` 依赖),随表单实时重画;点节点 → 跳到对应步骤表单行。编辑仍走表单。

**架构:** 纯函数 `scenarioToGraph`(ScenarioDef → 图数据,可单测)+ `ScenarioDagPreview` 组件(复用现有 AntV G6,只读,复用已稳的 G6 生命周期)+ `ScenarioEditor` 内嵌。无新依赖。

**分支:** `main`。

---

## F2.1 纯函数 `src/lib/scenarioGraph.ts`

```ts
export interface DagNode { id: string; label: string; }
export interface DagEdge { source: string; target: string; }
export function scenarioToGraph(s: ScenarioDef): { nodes: DagNode[]; edges: DagEdge[] };
```
- `nodes`:每个 step 一个,`label = id`(可附 ` · role`)。
- `edges`:每个 step 的每个 `after` 依赖 → 一条 `{ source: dep, target: step.id }`;**仅当 source/target 都是存在的 step**(对坏引用容错,不产出悬空边)。
- 空 steps → `{nodes:[],edges:[]}`。

## F2.2 组件 `src/components/ScenarioDagPreview.tsx`

Props:`{ scenario: ScenarioDef; onPickStep?: (id: string) => void }`。
- 用 G6 渲染 `scenarioToGraph(scenario)`:`antv-dagre` 布局(rankdir TB)、圆角矩形节点(显示 label)、细有向边(`endArrow`)、`animation:false`。
- 容器固定高度(~220px);`fitView`。
- **生命周期**:复用本会话已稳的 G6 套路 —— 单次 `render()`、`graph.destroyed` 守卫、StrictMode 下延迟 destroy(`const rendered = graph.render().catch(()=>{}); cleanup → graphRef=null; void rendered.finally(()=>graph.destroy())`)。`scenario` 变 → `setData(scenarioToGraph) + render`(渲染锁防重入)。
- 节点点击(`NodeEvent.CLICK`)→ `onPickStep(nodeId)`。
- 参考现有 `src/components/FlowGraph.tsx` 的 G6 用法(同 G6 v5.1.1)。

## F2.3 接入 `ScenarioEditor`

- 在「步骤(DAG)」区上方加可折叠面板(默认展开):`<ScenarioDagPreview scenario={s} onPickStep={pickStep} />`。
- `pickStep(id)`:把对应步骤的 DOM 行(给每个 `.editor-step` 加 `data-step-id={st.id}`)`scrollIntoView({block:"nearest"})` + 加一个短暂高亮 class(~1.2s)。
- 折叠开关:`const [showDag, setShowDag] = useState(true)`,标题行「依赖图 ▾/▸」。
- draft `s` 变(增删步骤/改 after)→ 图实时重画(组件 effect 依赖 scenario)。

## F2.4 错误处理 / 边界

- 校验由 A 的 `validate` 实时负责(环/坏引用 → 顶部红条 + 禁用保存)。图对坏引用容错(`scenarioToGraph` 不产悬空边);若存在环,dagre 仍能放置节点(边可能回绕),不崩即可。
- G6 实例随编辑器开关挂载/卸载 → 用已验证的延迟 destroy 防「destroyed/draw of undefined」竞态。
- 步骤为空 → 图空白占位。

## F2.5 测试

- `scenarioGraph.test.ts`(纯):steps/after → 正确 nodes/edges;空场景 → 空;坏 after 引用(指向不存在 step)→ 不产出该边;自环(after 含自身)→ 该边按规则产出或忽略(产出存在节点的边即可,不崩)。
- `ScenarioDagPreview` / 编辑器:tsc + 浏览器人工(建场景时图实时长出、点节点跳到步骤、折叠开关、非法时不崩)。

## F2.6 非目标

- 拖拽建图 / 拉边建依赖(本期只读;升级路径 = reactflow,见 F2 备选)。
- 在关系图 `FlowGraph` 里混入场景 DAG;导出图片;在只读图上直接改 role/prompt。

## 完成判据

- 编辑器加几个步骤 + 连依赖 → 顶部 DAG 实时反映拓扑(方向正确)。
- 点图中节点 → 对应步骤表单行滚动到视区并高亮。
- 折叠/展开正常;反复开关编辑器无 G6 控制台报错。
- 非法(环/坏引用)→ 表单红条拦截、图不崩。
- `bun test` 含 `scenarioGraph`(全绿);`tsc` 干净;`bun run build` 成功。
