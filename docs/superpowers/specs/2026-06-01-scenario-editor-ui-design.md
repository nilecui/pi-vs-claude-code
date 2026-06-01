# 场景编辑器 UI(子项目 C)设计

> 平台第三块。承接 A(ScenarioDef 数据模型 + 纯 `validate`)与 B(后端 scenario CRUD API)。让用户在浏览器里**纯靠表单**自助创建/编辑场景,无需写代码或 JSON。

**目标:** 在 dashboard 加一个表单式场景编辑器(模态),增删角色与步骤(DAG)、写 prompt 模板与 assembly,实时校验,保存经 B 的 `/api/scenarios` 落库,随即可在 ScenarioChat 运行。

**架构:** 一个纯草稿变换模块(`scenarioDraft.ts`,可单测)+ 一个模态表单组件(`ScenarioEditor.tsx`)+ ScenarioChat 的入口/刷新接线。校验直接复用 A 的纯 `validate`(实时)+ 后端保存时再校验(权威)。

**技术栈:** React 18 + TypeScript + Vite(现状);复用 `src/lib/orchestration/{types,validate}`、`src/api/client`。无新增依赖。

**分支:** `coms-dashboard-terminals`(A+B 已合入)。

---

## C.1 入口与位置

- `ScenarioChat` 头部(下拉旁)新增:
  - **`+ 新建`** → 打开空白编辑器。
  - **`编辑`** → 编辑当前选中场景;若该场景 `builtin=1`,按钮文案为 **`复制并编辑`**。
- 编辑器是覆盖层模态(`.editor-backdrop`/`.editor-modal`,样式与现有 `.result-*` 同族,新增)。不改三栏布局。
- 保存成功后:editor 关闭 → ScenarioChat 重新 `api.listScenarios()` → 选中刚保存的场景。

## C.2 单元与文件

| 文件 | 职责 |
|---|---|
| `src/lib/scenarioDraft.ts` | **纯函数**草稿变换(无 React):见下 C.3 |
| `src/lib/scenarioDraft.test.ts` | 草稿变换单测 |
| `src/components/ScenarioEditor.tsx` | 模态表单组件,持有草稿 state,实时校验,保存 |
| `src/api/client.ts`(改) | 补 `duplicateScenario(id)` |
| `src/components/ScenarioChat.tsx`(改) | 加「+ 新建 / 编辑」按钮 + 保存后刷新列表 |
| `src/styles.css`(改) | `.editor-*` 表单样式 |

## C.3 纯草稿模块 `scenarioDraft.ts`

把编辑逻辑从 UI 抽出便于测试。导出(均为不可变变换,返回新对象):

```ts
import type { ScenarioDef, RoleDef, StepDef } from "./orchestration/types";

export function blankScenario(): ScenarioDef;
// roles
export function addRole(s: ScenarioDef): ScenarioDef;                  // 追加占位角色 role-N
export function updateRole(s: ScenarioDef, i: number, patch: Partial<RoleDef>): ScenarioDef;
export function removeRole(s: ScenarioDef, i: number): ScenarioDef;
// steps
export function addStep(s: ScenarioDef): ScenarioDef;                  // 追加占位步骤 step-N
export function updateStep(s: ScenarioDef, i: number, patch: Partial<StepDef>): ScenarioDef;
export function removeStep(s: ScenarioDef, i: number): ScenarioDef;    // 同时从其它步骤的 after 移除该 id
export function toggleAfter(s: ScenarioDef, stepIdx: number, depId: string): ScenarioDef; // 勾/取消依赖
export function renameStepId(s: ScenarioDef, i: number, newId: string): ScenarioDef;      // 联动更新别处 after 引用
```

- `blankScenario` 返回最小可编辑骨架:`{ id:"", title:"", blurb:"", roles:[], input:{label:"",default:""}, steps:[], assembly:"" }`。
- `removeStep` / `renameStepId` 必须**联动修正**其它步骤 `after` 中对该 id 的引用(删除/改名),避免悬空引用。
- 默认新角色 `{ name:"role-1", provider:"openai-codex", model:"gpt-5.5", purpose:"", color:"#3b82f6" }`(name 自增避重)。新步骤 `{ id:"step-1", role:<第一个角色名或"">, prompt:"", after:[] }`(id 自增避重)。

## C.4 编辑器组件 `ScenarioEditor.tsx`

Props:`{ initial: ScenarioDef | null; onClose(): void; onSaved(id: string): void }`。
- **编辑器只编辑非内置草稿**:`initial === null` → 新建(`blankScenario()`,save 走 `createScenario`);`initial` 非空 → 编辑一个已存在的自定义场景(save 走 `updateScenario`)。内置场景在入口处已被「复制并编辑」转成自定义副本(见 C.5),不会带进编辑器。用 `isNew = initial === null` 判定保存路径。
- 草稿 `const [draft, setDraft] = useState<ScenarioDef>(initial ? structuredClone(initial) : blankScenario())`,所有改动经 `scenarioDraft.*` 变换。
- **实时校验**:`const errors = useMemo(() => validate(draft), [draft])`;非空时顶部红条列出,保存按钮禁用(`isNew` 且 id 为空也禁用)。
- 表单分区:标题/简介/id(`isNew` 可填,编辑时只读);输入 label+default;角色列表(每行 name/provider/model/purpose/color + 删除,底部「+ 角色」);步骤列表(每条 id 输入、角色下拉=`draft.roles[].name`、prompt 文本域、依赖区=其它步骤 id 的多选 chip(`toggleAfter`)+ 删除,底部「+ 步骤」);assembly 文本域。
- 保存:`isNew ? api.createScenario(draft) : api.updateScenario(draft.id, draft)`;后端校验失败(400 `details`)→ 顶部展示;成功 → `onSaved(draft.id)`。
- 删除(`!isNew` 时显示「删除」):`api.deleteScenario(draft.id)` → 成功 `onSaved("")`(调用方刷新并回到默认选中)。

## C.5 ScenarioChat 接线

- 头部加 `+ 新建` 与 `编辑`/`复制并编辑` 按钮(依当前选中场景 summary 的 `builtin` 切换后者文案)。
- **+ 新建**:`<ScenarioEditor initial={null} …/>`。
- **编辑**(选中为自定义):`const d = await api.getScenario(sid)` → `<ScenarioEditor initial={d} …/>`。
- **复制并编辑**(选中为内置):`const {id:newId} = await api.duplicateScenario(sid)` → `const copy = await api.getScenario(newId)` → `<ScenarioEditor initial={copy} …/>`(此时已是自定义副本,后续 save 走 update)。
- `onSaved(id)`:`await listScenarios()` 刷新下拉;`id` 非空则 `setSid(id)`,为空(删除后)则选列表首项。

## C.6 数据流

```
ScenarioChat[+新建/编辑] → ScenarioEditor(draft)
   draft --useMemo--> validate(draft) --> 内联错误(实时)
   [保存] --> api.create/update/(duplicate)Scenario --> 后端 validate+落库
        --> onSaved(id) --> ScenarioChat.listScenarios() + setSid(id)
```

## C.7 错误处理 / 边界

- 实时校验错 → 保存禁用 + 顶部列出(来自 A 的 `validate`)。
- 后端 400(权威校验)→ 展示 `details`;网络错 → 提示重试。
- 内置场景:不可原地改/删(B 已 409);编辑器走「复制」路径。
- id 规则:新建 id 必填、非空;`renameStepId`/role name 改动即时反映到下拉与依赖 chip。

## C.8 测试

- `scenarioDraft.test.ts`(纯单测):`blankScenario` 形状;`addStep/addRole` 自增不重名;`removeStep` 联动从他步 `after` 摘除;`renameStepId` 联动改他步 `after` 引用;`toggleAfter` 增删依赖;`updateRole/updateStep` patch 合并。
- `validate` 已在 A 覆盖(编辑器直接复用)。
- 编辑器组件:tsc + 浏览器人工验证(下方完成判据)。

## C.9 非目标

- 可视化 DAG 拖拽编辑(本期表单式;DAG 由 `after` 表达,表单已覆盖)。
- 场景导入/导出、版本历史(后续可加)。
- 账号/权限(D);运行历史 UI(E)。

## 完成判据

- 浏览器里点「+ 新建」→ 纯表单填角色+步骤(连依赖)+ prompt → 实时校验通过 → 保存 → 出现在下拉 → 运行得到真实产出。
- 「复制并编辑」内置场景 → 改造 → 存为自定义可运行。
- 故意造非法(id 重复 / 坏引用 / 环 / prompt 引用非传递依赖)→ 实时红条拦截、保存禁用。
- `bun test`(含 scenarioDraft)全绿;`tsc` 干净;`bun run build` 成功。
