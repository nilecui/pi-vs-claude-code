# 配置驱动编排内核(子项目 A)设计

> 本文是把 `coms-dashboard` 从「硬编码 3 个场景」泛化为「平台级、可配置、可持久化的多 Agent 编排产品」的**第一个子项目(A)**的设计。整体平台分解与建造顺序见下方「平台背景」一节;A 是基石,后续 B/C/D/E 各自再走 spec → plan → 实现。

**目标:** 把场景从代码(`realScenarios.ts` 的命令式 `orchestrate()`)变成**纯数据(`ScenarioDef`)**,由一个通用解释器执行,从而"配置即可创建编排",为持久化/编辑器/多用户打底。

**架构:** 声明式「步骤 DAG + 模板化 prompt」模型 + 拓扑执行解释器。解释器与 React 解耦,复用本仓库已验证的运行引擎(msg_id 关联的 `ask`、只 spawn 缺失角色、装配产出)。纯逻辑单元可用 mock `ask` 单测。

**技术栈:** TypeScript、React 18 + Zustand(现状)、Vite、`bun test`。A **不新增**运行时依赖,不引入后端/DB。

---

## 平台背景(整体分解,非本子项目实现范围)

确定的产品定位(已与用户对齐):**自托管单主机多用户**——部署在团队可控的一台/少量服务器;Agent 仍由服务端 spawner 在主机 tmux/PTY 里启动(沿用 pi TUI + 本机订阅,不动执行层);"多用户"体现在账号 + 场景共享 + 权限 + 持久化。

| 子项目 | 内容 | 依赖 |
|---|---|---|
| **A(本文)** | 配置驱动编排内核:`ScenarioDef` 数据模型 + 模板引擎 + 校验器 + 解释器;替换 `realScenarios.ts` | 无 |
| B | 后端 API(Bun)+ SQLite:scenarios/runs/results 持久化,前端改走 API | A |
| C | 场景编辑器 UI:自助加角色、连流程(表单模板 vs 可视化 DAG 留待 C 细化) | A、B |
| D | 账号/多租户/权限/共享 | B |
| E | 运行历史与产出库 | B |

建造顺序:**A → B → C → E → D**。A 单独完成即可"从注册表数据加载任意场景并运行",立即 de-risk 后续。

---

## A 的数据模型

```ts
export interface RoleDef {
  name: string;       // coms-net 上的 agent 名,steps 用它引用
  provider: string;   // 如 "openai-codex"
  model: string;      // 如 "gpt-5.5"
  purpose: string;
  color: string;
}

export interface StepDef {
  id: string;            // 场景内唯一
  role: string;          // 引用 RoleDef.name
  prompt: string;        // 模板:支持 {{input}} 与 {{steps.<id>}}
  after: string[];       // 依赖的 step id;[] = 无依赖(就绪即并行)
  timeoutMs?: number;    // 缺省 240000
}

export interface ScenarioDef {
  id: string;
  title: string;
  blurb: string;
  roles: RoleDef[];
  input: { label: string; default: string };
  steps: StepDef[];
  assembly?: string;     // 模板;缺省 = 汇点 step 产出(见下「assembly 缺省」)
}
```

**assembly 缺省:** 若未提供 `assembly`,默认装配 = **所有「汇点」步骤**(没有任何其它 step 在 `after` 里引用它的步骤)的产出,按 `steps[]` 定义顺序用 `\n\n---\n\n` 拼接。3 个内置场景都显式提供 `assembly`,故缺省仅对最简新场景生效。

**约定:**
- 「禁止转发」指令(`【只回答,不要转发】…禁止使用 coms / coms_net …`)由**解释器在每步 prompt 末尾自动追加**,配置者不必重写。(未来可加 `StepDef.allowDelegation?: boolean` 放开;A 不做。)
- `timeoutMs` 缺省 240000;可按步覆盖。
- 同一 `role` 可被多个 step 引用(如合同场景 `risk-reviewer` 出现在「标风险」和「复核红线」两步)。

## 单元分解

每个单元一个文件、职责单一、可独立测试。

### 单元 1 · 模板引擎 `lib/orchestration/template.ts`
- `render(tpl: string, ctx: { input: string; steps: Record<string,string> }): string`
- 仅替换 `{{input}}` 和 `{{steps.<id>}}`(正则);未知引用替换为空字符串。**无逻辑/条件/循环(YAGNI)。**
- 纯函数。
- 配套 `collectRefs(tpl): { input: boolean; steps: string[] }` 供校验器检查模板里引用的 step 是否存在。

### 单元 2 · 校验器 `lib/orchestration/validate.ts`
- `validate(s: ScenarioDef): string[]`(返回错误信息列表,空=通过)。
- 规则:
  1. step id 唯一、非空;
  2. 每个 `step.role` 必须在 `roles[]` 中存在;
  3. 每个 `after` 元素必须是已存在的 step id;
  4. 每个 prompt / assembly 模板里 `{{steps.<id>}}` 引用的 id 必须存在;
  5. 依赖图**无环**(拓扑排序成功);
  6. `roles` 与 `steps` 非空。
- 纯函数。

### 单元 3 · 解释器 `lib/orchestration/runScenario.ts`
- 签名:
  ```ts
  interface RunDeps {
    ask: (role: string, prompt: string, timeoutMs: number) => Promise<string>;
    spawnMissing: (roles: RoleDef[]) => Promise<boolean>; // 起缺失角色,等注册,成功true
    onStepUpdate: (id: string, status: StepStatus, text?: string) => void;
    onStatus: (msg: string) => void;
    onResult: (markdown: string) => void;
  }
  type StepStatus = "pending" | "running" | "done" | "error" | "timeout";
  async function runScenario(s: ScenarioDef, input: string, deps: RunDeps): Promise<void>;
  ```
- 流程:
  1. 调 `validate`,有错则 `onStatus(错误)` 并 return(不运行);
  2. `spawnMissing(roles)`,失败则 `onStatus` 报错 return;
  3. 维护每步 status;循环:取「`after` 全部 done 且自身未启动」的步骤,**`Promise.all` 并发**执行 `ask(role, render(prompt)+禁止转发后缀, timeoutMs)`;产出存入 `steps[id]`;`onStepUpdate` 通知 UI;超时/错→标记 `timeout`/`error`,产出存占位符文本(下游照常运行并能显示该占位符);
  4. 全部终态后:有 `assembly` 则 `render(assembly)`,否则按「assembly 缺省」(汇点步骤产出拼接)→ `onResult`。
- **不依赖 React / store**;`ask`/`spawnMissing` 由调用方注入 → 可用 mock 单测(断言并行分组、顺序、超时传播、assembly 结果)。

### 单元 4 · 场景注册表 `lib/orchestration/scenarios.ts`
- 把现有 3 个场景转写为 `ScenarioDef` 数据,导出 `SCENARIOS: ScenarioDef[]`,替换旧 `REAL_SCENARIOS`。
- 等价映射:
  - **层级**:steps `lead-a`(after[])、`lead-b`(after[])、`boss`(after[lead-a,lead-b]);assembly = 综合结论 + 两 lead 附录。
  - **标书**:`tech`(after[])、`comm`(after[])、`comp`(after[tech,comm])、`lead`(after[comp]);assembly = 大纲 + 技术正文 + 商务正文 + 合规(现已实现的装配)。
  - **合同**:`intake`→`risk`→`redline`→`recheck`(risk 角色)→`legal`,串行 `after` 链;assembly = 意见书 + 各环节附录。

### 单元 5 · 接线 `components/ScenarioChat.tsx`(改造,非重写)
- 删除对 `realScenarios.orchestrate` 的依赖,改为 `runScenario(selected, input, deps)`。
- `deps`:
  - `ask` = 现有 msg_id 关联实现(保留);
  - `spawnMissing` = 现有 spawn `/spawner/spawn` + `waitFor`(保留,只起缺失角色);
  - `onStepUpdate`/`onStatus`/`onResult` = 写入组件 state,驱动现有视觉(分派药丸、角色气泡、状态、`📄 查看完整产出` 弹窗)。
- 视觉与交互**不变**,仅由"每场景写死的 orchestrate"变为"通用解释器 + 数据"。

## 数据流

```
用户选场景(ScenarioDef) + 填 input
        │
ScenarioChat.onSend → runScenario(scenario, input, deps)
        │
   validate → spawnMissing(roles) → 拓扑循环{ ask(role, render(prompt)) }并发
        │                                   │ onStepUpdate → UI(药丸/气泡/状态)
   收集 steps[id] ── 全部终态 ── render(assembly) → onResult → 「查看完整产出」
```

## 错误处理

- **校验错**:运行前 `onStatus` 显示并阻止运行。
- **步骤超时/错**:该步标 `timeout`/`error`,产出存占位符(如「(超时:未收到回复)」),下游步骤照常执行并能在 prompt/产出里显示该占位符——保持"诚实报告"语义(对应 boss 如实报超时)。整体流程不中断。(halt-on-error 作为后续可配项,A 不做。)
- **spawn 失败**(spawner 未运行/注册超时):`onStatus` 提示,不进入执行。

## 测试

`bun test`,纯单元为主:
1. `template.test.ts`:`{{input}}` / `{{steps.x}}` 替换;未知引用→空;多引用;`collectRefs` 正确。
2. `validate.test.ts`:重复 id、未知 role、`after` 坏引用、模板坏引用、**环**、空 steps —— 各产出对应错误;合法场景→`[]`。
3. `runScenario.test.ts`(mock `ask`):
   - 标书拓扑:`tech`/`comm` 并发(同一就绪批),`comp` 等两者,`lead` 最后;
   - 超时传播:某步 mock 超时→该步 `timeout`,下游仍跑且 prompt 含占位符;
   - assembly 结果包含各 step 产出。
4. `scenarios.test.ts`:3 个内置场景 `validate` 通过;其依赖拓扑顺序与改造前一致(回归基线)。

## 边界 / 非目标(A)

- **不含** DB、后端 API、编辑器 UI、账号/权限(归 B/C/D/E)。
- 场景来自仓库内 `scenarios.ts` 数据注册表(尚非 DB)。
- 模板**无条件/循环/表达式**(线性 DAG);合同的 risk 两次=两个 step,非循环。
- Agent 执行层不变(spawner + tmux,沿用 pi TUI + 本机订阅)。

## 完成判据

- 3 个内置场景以 `ScenarioDef` 数据形式运行,行为与当前一致(含装配产出);
- `realScenarios.ts` 的命令式 `orchestrate()` 被解释器替代并删除;
- 上述单测全绿;
- 新增一个**纯数据**场景(不写任何 TS 逻辑,仅加一个 `ScenarioDef`)即可运行,以证明"配置即编排"。
