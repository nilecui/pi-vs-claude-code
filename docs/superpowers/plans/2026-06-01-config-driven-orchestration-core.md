# 配置驱动编排内核(子项目 A)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 coms-dashboard 的场景从硬编码的命令式 `orchestrate()` 改为「纯数据 `ScenarioDef` + 通用解释器」,实现"配置即编排"。

**Architecture:** 声明式「步骤 DAG + 模板化 prompt」模型;一个与 React 解耦的拓扑执行解释器(纯逻辑,`ask`/`spawnMissing` 注入,可 mock 单测);把现有 3 个场景转成数据;ScenarioChat 改为调用解释器,视觉不变。

**Tech Stack:** TypeScript、React 18 + Zustand、Vite、`bun test`。不新增运行时依赖,不引入后端/DB。

**Spec:** `docs/superpowers/specs/2026-06-01-config-driven-orchestration-core-design.md`
**Branch:** `coms-dashboard-orchestration-core`
**工作目录:** 所有命令在 `apps/coms-dashboard/` 下执行(`cd apps/coms-dashboard`)。

---

## 文件结构

新建目录 `apps/coms-dashboard/src/lib/orchestration/`:

| 文件 | 职责 |
|---|---|
| `types.ts` | `RoleDef` / `StepDef` / `ScenarioDef` / `StepStatus` / `RunDeps` 类型 |
| `template.ts` | `render` / `collectRefs` 模板引擎(纯) |
| `template.test.ts` | 模板引擎单测 |
| `validate.ts` | `validate(scenario)` 校验器(纯) |
| `validate.test.ts` | 校验器单测 |
| `runScenario.ts` | 解释器 `runScenario` + `assemble` + 常量 `DELEGATION_SUFFIX` / `TIMEOUT_TEXT` |
| `runScenario.test.ts` | 解释器单测(mock `ask`) |
| `scenarios.ts` | 3 个内置场景的 `ScenarioDef` 数据 + `SCENARIOS` 导出 |
| `scenarios.test.ts` | 场景数据校验 + 拓扑回归 |

修改:`src/components/ScenarioChat.tsx`(接线)。
删除:`src/lib/realScenarios.ts`(被 `scenarios.ts` + 解释器取代)。

---

### Task 1: 编排模块类型

**Files:**
- Create: `apps/coms-dashboard/src/lib/orchestration/types.ts`

- [ ] **Step 1: 写类型文件**

```ts
// src/lib/orchestration/types.ts

export interface RoleDef {
  name: string; // coms-net 上的 agent 名;steps 用它引用
  provider: string; // 如 "openai-codex"
  model: string; // 如 "gpt-5.5"
  purpose: string;
  color: string;
}

export interface StepDef {
  id: string; // 场景内唯一
  role: string; // 引用 RoleDef.name
  prompt: string; // 模板:支持 {{input}} 与 {{steps.<id>}}
  after: string[]; // 依赖的 step id;[] = 无依赖(就绪即并行)
  timeoutMs?: number; // 缺省 240000
}

export interface ScenarioDef {
  id: string;
  title: string;
  blurb: string;
  roles: RoleDef[];
  input: { label: string; default: string };
  steps: StepDef[];
  assembly?: string; // 模板;缺省 = 汇点步骤产出拼接
}

export type StepStatus = "pending" | "running" | "done" | "error" | "timeout";

export interface RunDeps {
  // 向某 role 发一条消息并解析为该消息的回复(超时返回 TIMEOUT_TEXT,不抛)
  ask: (role: string, prompt: string, timeoutMs: number) => Promise<string>;
  // 起缺失角色、等注册;全部就绪返回 true
  spawnMissing: (roles: RoleDef[]) => Promise<boolean>;
  onStepUpdate: (id: string, status: StepStatus, text?: string) => void;
  onStatus: (msg: string) => void;
  onResult: (markdown: string) => void;
}
```

- [ ] **Step 2: 校验编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出(通过)。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/src/lib/orchestration/types.ts
git commit -m "feat(orchestration): add ScenarioDef/StepDef/RunDeps types"
```

---

### Task 2: 模板引擎

**Files:**
- Create: `apps/coms-dashboard/src/lib/orchestration/template.ts`
- Test: `apps/coms-dashboard/src/lib/orchestration/template.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/orchestration/template.test.ts
import { expect, test } from "bun:test";
import { render, collectRefs } from "./template";

test("render 替换 {{input}}", () => {
  expect(render("任务:{{input}}", { input: "做X", steps: {} })).toBe("任务:做X");
});

test("render 替换 {{steps.<id>}}(含连字符 id)", () => {
  expect(render("A={{steps.lead-a}}", { input: "", steps: { "lead-a": "答A" } })).toBe("A=答A");
});

test("render 未知 step 引用 → 空串", () => {
  expect(render("X={{steps.nope}}", { input: "", steps: {} })).toBe("X=");
});

test("render 容忍内部空格", () => {
  expect(render("{{ input }} {{ steps.t }}", { input: "i", steps: { t: "v" } })).toBe("i v");
});

test("collectRefs 报告 input 与 step 引用(去重)", () => {
  const r = collectRefs("{{input}} {{steps.a}} {{steps.a}} {{steps.b}}");
  expect(r.input).toBe(true);
  expect(r.steps.sort()).toEqual(["a", "b"]);
});

test("collectRefs 无 input 时 input=false", () => {
  expect(collectRefs("{{steps.a}}").input).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/template.test.ts`
Expected: FAIL — 报 `Cannot find module './template'` 或 `render is not a function`。

- [ ] **Step 3: 写实现**

```ts
// src/lib/orchestration/template.ts

const INPUT_RE = /\{\{\s*input\s*\}\}/g;
const STEP_RE = /\{\{\s*steps\.([A-Za-z0-9_-]+)\s*\}\}/g;

export function render(tpl: string, ctx: { input: string; steps: Record<string, string> }): string {
  return tpl
    .replace(INPUT_RE, ctx.input)
    .replace(STEP_RE, (_m, id: string) => ctx.steps[id] ?? "");
}

export function collectRefs(tpl: string): { input: boolean; steps: string[] } {
  const input = /\{\{\s*input\s*\}\}/.test(tpl);
  const steps: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(STEP_RE.source, "g");
  while ((m = re.exec(tpl)) !== null) steps.push(m[1]);
  return { input, steps: [...new Set(steps)] };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/template.test.ts`
Expected: PASS(6 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/lib/orchestration/template.ts apps/coms-dashboard/src/lib/orchestration/template.test.ts
git commit -m "feat(orchestration): template render + collectRefs"
```

---

### Task 3: 校验器

**Files:**
- Create: `apps/coms-dashboard/src/lib/orchestration/validate.ts`
- Test: `apps/coms-dashboard/src/lib/orchestration/validate.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/orchestration/validate.test.ts
import { expect, test } from "bun:test";
import { validate } from "./validate";
import type { ScenarioDef } from "./types";

const role = { name: "a", provider: "p", model: "m", purpose: "", color: "#000" };
function scn(over: Partial<ScenarioDef>): ScenarioDef {
  return {
    id: "s", title: "t", blurb: "b",
    roles: [role],
    input: { label: "l", default: "d" },
    steps: [{ id: "s1", role: "a", prompt: "{{input}}", after: [] }],
    ...over,
  };
}

test("合法场景 → 无错误", () => {
  expect(validate(scn({}))).toEqual([]);
});

test("空 roles / 空 steps 报错", () => {
  const e = validate(scn({ roles: [], steps: [] }));
  expect(e.some((x) => x.includes("roles"))).toBe(true);
  expect(e.some((x) => x.includes("steps"))).toBe(true);
});

test("重复 step id 报错", () => {
  const e = validate(scn({ steps: [
    { id: "s1", role: "a", prompt: "", after: [] },
    { id: "s1", role: "a", prompt: "", after: [] },
  ] }));
  expect(e.some((x) => x.includes("重复"))).toBe(true);
});

test("step 引用未定义 role 报错", () => {
  const e = validate(scn({ steps: [{ id: "s1", role: "ghost", prompt: "", after: [] }] }));
  expect(e.some((x) => x.includes("role") && x.includes("ghost"))).toBe(true);
});

test("after 引用不存在的 step 报错", () => {
  const e = validate(scn({ steps: [{ id: "s1", role: "a", prompt: "", after: ["nope"] }] }));
  expect(e.some((x) => x.includes("after") && x.includes("nope"))).toBe(true);
});

test("prompt 模板引用不存在的 step 报错", () => {
  const e = validate(scn({ steps: [{ id: "s1", role: "a", prompt: "{{steps.nope}}", after: [] }] }));
  expect(e.some((x) => x.includes("prompt") && x.includes("nope"))).toBe(true);
});

test("环依赖报错", () => {
  const e = validate(scn({ steps: [
    { id: "s1", role: "a", prompt: "", after: ["s2"] },
    { id: "s2", role: "a", prompt: "", after: ["s1"] },
  ] }));
  expect(e.some((x) => x.includes("环"))).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`。

- [ ] **Step 3: 写实现**

```ts
// src/lib/orchestration/validate.ts
import type { ScenarioDef } from "./types";
import { collectRefs } from "./template";

export function validate(s: ScenarioDef): string[] {
  const errors: string[] = [];
  if (!s.roles || s.roles.length === 0) errors.push("roles 不能为空");
  if (!s.steps || s.steps.length === 0) errors.push("steps 不能为空");

  const roleNames = new Set((s.roles ?? []).map((r) => r.name));
  const ids = (s.steps ?? []).map((st) => st.id);
  const seen = new Set<string>();

  for (const st of s.steps ?? []) {
    if (!st.id) errors.push("存在空的 step id");
    else if (seen.has(st.id)) errors.push(`step id 重复: ${st.id}`);
    seen.add(st.id);
    if (!roleNames.has(st.role)) errors.push(`step ${st.id} 引用了未定义的 role: ${st.role}`);
    for (const dep of st.after ?? []) {
      if (!ids.includes(dep)) errors.push(`step ${st.id} 的 after 引用了不存在的 step: ${dep}`);
    }
    for (const ref of collectRefs(st.prompt).steps) {
      if (!ids.includes(ref)) errors.push(`step ${st.id} 的 prompt 引用了不存在的 step: ${ref}`);
    }
  }
  if (s.assembly) {
    for (const ref of collectRefs(s.assembly).steps) {
      if (!ids.includes(ref)) errors.push(`assembly 引用了不存在的 step: ${ref}`);
    }
  }
  if (errors.length === 0 && hasCycle(s)) errors.push("steps 依赖存在环");
  return errors;
}

function hasCycle(s: ScenarioDef): boolean {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const st of s.steps) {
    indeg.set(st.id, 0);
    adj.set(st.id, []);
  }
  for (const st of s.steps) {
    for (const dep of st.after ?? []) {
      adj.get(dep)?.push(st.id);
      indeg.set(st.id, (indeg.get(st.id) ?? 0) + 1);
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const nb of adj.get(id) ?? []) {
      indeg.set(nb, (indeg.get(nb) ?? 0) - 1);
      if (indeg.get(nb) === 0) queue.push(nb);
    }
  }
  return visited !== s.steps.length;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/validate.test.ts`
Expected: PASS(7 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/lib/orchestration/validate.ts apps/coms-dashboard/src/lib/orchestration/validate.test.ts
git commit -m "feat(orchestration): scenario validator (ids/roles/refs/cycle)"
```

---

### Task 4: 解释器

**Files:**
- Create: `apps/coms-dashboard/src/lib/orchestration/runScenario.ts`
- Test: `apps/coms-dashboard/src/lib/orchestration/runScenario.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/orchestration/runScenario.test.ts
import { expect, test } from "bun:test";
import { runScenario, assemble, TIMEOUT_TEXT, DELEGATION_SUFFIX } from "./runScenario";
import type { ScenarioDef, RunDeps, StepStatus } from "./types";

const role = { name: "a", provider: "p", model: "m", purpose: "", color: "#000" };

// 标书式拓扑:tech/comm 并行 → comp 依赖二者 → lead 依赖 comp
function bidScn(): ScenarioDef {
  return {
    id: "bid", title: "t", blurb: "b",
    roles: [
      { ...role, name: "tw" }, { ...role, name: "cm" },
      { ...role, name: "cp" }, { ...role, name: "ld" },
    ],
    input: { label: "l", default: "d" },
    steps: [
      { id: "tech", role: "tw", prompt: "T:{{input}}", after: [] },
      { id: "comm", role: "cm", prompt: "C:{{input}}", after: [] },
      { id: "comp", role: "cp", prompt: "{{steps.tech}}|{{steps.comm}}", after: ["tech", "comm"] },
      { id: "lead", role: "ld", prompt: "{{steps.comp}}", after: ["comp"] },
    ],
    assembly: "FINAL {{steps.lead}}",
  };
}

function deps(over: Partial<RunDeps> & { calls?: string[] }): RunDeps {
  const calls = over.calls ?? [];
  return {
    ask: async (role, prompt) => { calls.push(role); return `out-${role}`; },
    spawnMissing: async () => true,
    onStepUpdate: () => {},
    onStatus: () => {},
    onResult: () => {},
    ...over,
  };
}

test("拓扑执行:tech/comm 在 comp 之前,comp 在 lead 之前", async () => {
  const order: string[] = [];
  await runScenario(bidScn(), "X", deps({
    ask: async (role) => { order.push(role); return `out-${role}`; },
  }));
  expect(order.indexOf("tw")).toBeLessThan(order.indexOf("cp"));
  expect(order.indexOf("cm")).toBeLessThan(order.indexOf("cp"));
  expect(order.indexOf("cp")).toBeLessThan(order.indexOf("ld"));
});

test("prompt 用上游产出插值,并追加禁止转发后缀", async () => {
  const seen: Record<string, string> = {};
  await runScenario(bidScn(), "X", deps({
    ask: async (role, prompt) => { seen[role] = prompt; return `out-${role}`; },
  }));
  expect(seen["tw"]).toContain("T:X");
  expect(seen["cp"]).toContain("out-tw|out-cm");
  expect(seen["tw"]).toContain(DELEGATION_SUFFIX.trim().slice(0, 8));
});

test("onResult 收到装配后的最终产出", async () => {
  let result = "";
  await runScenario(bidScn(), "X", deps({ onResult: (r) => { result = r; } }));
  expect(result).toBe("FINAL out-ld");
});

test("校验失败 → onStatus 报错且不执行 ask", async () => {
  let asked = false;
  let status = "";
  const bad = { ...bidScn(), steps: [{ id: "x", role: "ghost", prompt: "", after: [] }] };
  await runScenario(bad, "X", deps({
    ask: async () => { asked = true; return ""; },
    onStatus: (m) => { status = m; },
  }));
  expect(asked).toBe(false);
  expect(status).toContain("校验失败");
});

test("spawnMissing 失败 → 不执行 ask", async () => {
  let asked = false;
  await runScenario(bidScn(), "X", deps({
    spawnMissing: async () => false,
    ask: async () => { asked = true; return ""; },
  }));
  expect(asked).toBe(false);
});

test("某步超时 → 标记 timeout,下游仍运行且收到占位符", async () => {
  const statuses: Record<string, StepStatus> = {};
  let compPrompt = "";
  await runScenario(bidScn(), "X", deps({
    ask: async (role, prompt) => {
      if (role === "tw") return TIMEOUT_TEXT;
      if (role === "cp") compPrompt = prompt;
      return `out-${role}`;
    },
    onStepUpdate: (id, st) => { statuses[id] = st; },
  }));
  expect(statuses["tech"]).toBe("timeout");
  expect(statuses["comp"]).toBe("done");
  expect(compPrompt).toContain(TIMEOUT_TEXT); // 下游拿到上游超时占位符
});

test("assemble 缺省 = 汇点步骤产出拼接", () => {
  const s = bidScn();
  delete s.assembly;
  // lead 是唯一汇点(没有别的 step 在 after 里引用它)
  expect(assemble(s, { tech: "a", comm: "b", comp: "c", lead: "d" })).toBe("d");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/runScenario.test.ts`
Expected: FAIL — `Cannot find module './runScenario'`。

- [ ] **Step 3: 写实现**

```ts
// src/lib/orchestration/runScenario.ts
import type { ScenarioDef, RunDeps, StepStatus } from "./types";
import { render } from "./template";
import { validate } from "./validate";

// 与 ScenarioChat 的 ask() 共用的超时哨兵文本(ask 超时时 resolve 此串,不抛)
export const TIMEOUT_TEXT = "(超时:未收到回复)";

// 被调 agent 必须只回答、不再外联,否则会 lead↔lead 互等死锁。解释器统一追加。
export const DELEGATION_SUFFIX =
  "\n\n【只回答,不要转发】请直接把结果回复给控制面板。禁止使用 coms / coms_net 等工具联系、转发或等待其它 agent —— 你已拥有完成本步骤所需的全部信息。";

const DEFAULT_TIMEOUT = 240000;

export async function runScenario(s: ScenarioDef, input: string, deps: RunDeps): Promise<void> {
  const errs = validate(s);
  if (errs.length) {
    deps.onStatus("场景校验失败:" + errs.join(";"));
    return;
  }
  const ok = await deps.spawnMissing(s.roles);
  if (!ok) {
    deps.onStatus("部分 agent 未就绪,无法运行");
    return;
  }

  const outputs: Record<string, string> = {};
  const status = new Map<string, StepStatus>(s.steps.map((st) => [st.id, "pending"]));
  for (const st of s.steps) deps.onStepUpdate(st.id, "pending");

  const terminal = (id: string) => {
    const st = status.get(id);
    return st === "done" || st === "error" || st === "timeout";
  };
  const pending = () => s.steps.filter((st) => status.get(st.id) === "pending");

  while (pending().length) {
    const ready = pending().filter((st) => (st.after ?? []).every(terminal));
    if (ready.length === 0) break; // 校验已保证无环,理论不会到这

    deps.onStatus("运行中:" + ready.map((st) => st.role).join(" / "));
    ready.forEach((st) => status.set(st.id, "running"));
    ready.forEach((st) => deps.onStepUpdate(st.id, "running"));

    await Promise.all(
      ready.map(async (st) => {
        const prompt = render(st.prompt, { input, steps: outputs }) + DELEGATION_SUFFIX;
        try {
          const text = await deps.ask(st.role, prompt, st.timeoutMs ?? DEFAULT_TIMEOUT);
          const fin: StepStatus = text === TIMEOUT_TEXT ? "timeout" : "done";
          outputs[st.id] = text;
          status.set(st.id, fin);
          deps.onStepUpdate(st.id, fin, text);
        } catch (e) {
          const text = `(执行出错:${String(e)})`;
          outputs[st.id] = text;
          status.set(st.id, "error");
          deps.onStepUpdate(st.id, "error", text);
        }
      }),
    );
  }

  deps.onResult(assemble(s, outputs));
  deps.onStatus("完成 ✓");
}

export function assemble(s: ScenarioDef, outputs: Record<string, string>): string {
  if (s.assembly) return render(s.assembly, { input: "", steps: outputs });
  const referenced = new Set<string>();
  for (const st of s.steps) for (const d of st.after ?? []) referenced.add(d);
  const sinks = s.steps.filter((st) => !referenced.has(st.id));
  return sinks.map((st) => outputs[st.id] ?? "").join("\n\n---\n\n");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/runScenario.test.ts`
Expected: PASS(7 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/lib/orchestration/runScenario.ts apps/coms-dashboard/src/lib/orchestration/runScenario.test.ts
git commit -m "feat(orchestration): topological interpreter with assembly + timeout propagation"
```

---

### Task 5: 场景注册表(3 场景转数据)

**Files:**
- Create: `apps/coms-dashboard/src/lib/orchestration/scenarios.ts`
- Test: `apps/coms-dashboard/src/lib/orchestration/scenarios.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/orchestration/scenarios.test.ts
import { expect, test } from "bun:test";
import { SCENARIOS } from "./scenarios";
import { validate } from "./validate";

test("内置 3 个场景,id 为 hierarchy/bid/contract", () => {
  expect(SCENARIOS.map((s) => s.id).sort()).toEqual(["bid", "contract", "hierarchy"]);
});

test("每个内置场景都通过校验", () => {
  for (const s of SCENARIOS) {
    expect(validate(s)).toEqual([]);
  }
});

test("标书场景:tech/comm 无依赖,comp 依赖两者,lead 依赖 comp", () => {
  const bid = SCENARIOS.find((s) => s.id === "bid")!;
  const by = Object.fromEntries(bid.steps.map((st) => [st.id, st]));
  expect(by["tech"].after).toEqual([]);
  expect(by["comm"].after).toEqual([]);
  expect(by["comp"].after.sort()).toEqual(["comm", "tech"]);
  expect(by["lead"].after).toEqual(["comp"]);
});

test("合同场景:risk 角色被两个 step 复用(risk + recheck)", () => {
  const c = SCENARIOS.find((s) => s.id === "contract")!;
  const riskSteps = c.steps.filter((st) => st.role === "risk-reviewer");
  expect(riskSteps.map((st) => st.id).sort()).toEqual(["recheck", "risk"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/scenarios.test.ts`
Expected: FAIL — `Cannot find module './scenarios'`。

- [ ] **Step 3: 写实现**

```ts
// src/lib/orchestration/scenarios.ts
import type { ScenarioDef } from "./types";

const hierarchy: ScenarioDef = {
  id: "hierarchy",
  title: "层级编排(演示)",
  blurb: "面板并行问两个 lead → boss 汇总",
  roles: [
    { name: "boss", color: "#3b82f6", provider: "openai-codex", model: "gpt-5.5", purpose: "层级根:汇总两位组长的回答" },
    { name: "lead-a", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "组长 A" },
    { name: "lead-b", color: "#f59e0b", provider: "openai-codex", model: "gpt-5.5", purpose: "组长 B" },
  ],
  input: { label: "下发的任务…", default: "你负责领域里最该优先解决的一个问题是什么?请用 2-3 句简洁回答。" },
  steps: [
    { id: "lead-a", role: "lead-a", prompt: "你是组长 lead-a。任务:{{input}}", after: [] },
    { id: "lead-b", role: "lead-b", prompt: "你是组长 lead-b。任务:{{input}}", after: [] },
    {
      id: "boss",
      role: "boss",
      prompt: "你是 boss。下面是两位组长对同一任务的回答,请汇总后给出一个综合结论(用 Markdown)。\n\n【lead-a】\n{{steps.lead-a}}\n\n【lead-b】\n{{steps.lead-b}}",
      after: ["lead-a", "lead-b"],
    },
  ],
  assembly: "# 综合结论(boss)\n\n{{steps.boss}}\n\n---\n\n## 附:lead-a 原始回答\n\n{{steps.lead-a}}\n\n## 附:lead-b 原始回答\n\n{{steps.lead-b}}",
};

const bid: ScenarioDef = {
  id: "bid",
  title: "标书制作(投标响应)",
  blurb: "面板并行派写作 → compliance 校验 → bid-lead 整合",
  roles: [
    { name: "bid-lead", color: "#3b82f6", provider: "openai-codex", model: "gpt-5.5", purpose: "投标负责人:整合标书大纲 + 废标项自检表" },
    { name: "tech-writer", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "技术方案撰写" },
    { name: "commercial", color: "#f59e0b", provider: "openai-codex", model: "gpt-5.5", purpose: "商务/资质/报价撰写" },
    { name: "compliance", color: "#ef4444", provider: "openai-codex", model: "gpt-5.5", purpose: "合规审查:对照废标项/资格条件校验" },
  ],
  input: {
    label: "粘贴招标文件(RFP)要点 / 评分项 / 废标项…",
    default:
      "项目:XX 政务云平台采购\n资格:近3年同类业绩≥2;ISO27001;注册资金≥500万\n技术评分:架构30 / 安全合规25 / 实施方案20 / 售后15 / 案例10\n废标项:未提供资质原件扫描件;报价超预算1200万;技术方案缺少等保三级方案",
  },
  steps: [
    { id: "tech", role: "tech-writer", after: [], prompt: "你是技术方案撰写 tech-writer。根据以下 RFP 撰写「技术方案章节」(总体架构/安全合规/实施方案/售后/案例,并单列等保三级安全建设方案),用 Markdown,要点清晰。\n\nRFP:\n{{input}}" },
    { id: "comm", role: "commercial", after: [], prompt: "你是商务撰写 commercial。根据以下 RFP 撰写「商务/资质/报价章节」(资格条件逐项响应、报价不超预算、资质清单),用 Markdown。\n\nRFP:\n{{input}}" },
    { id: "comp", role: "compliance", after: ["tech", "comm"], prompt: "你是合规审查 compliance。对照下面 RFP 的「资格条件 + 废标项」,逐条校验两份草稿是否满足,输出「缺失项清单 + 整改建议」(Markdown 表格)。\n\nRFP:\n{{input}}\n\n【技术稿】\n{{steps.tech}}\n\n【商务稿】\n{{steps.comm}}" },
    { id: "lead", role: "bid-lead", after: ["comp"], prompt: "你是投标负责人 bid-lead。请整合下面材料,输出「标书大纲 + 废标项自检表」(Markdown),并在末尾给出投标重点结论。\n\nRFP:\n{{input}}\n\n【技术稿】\n{{steps.tech}}\n\n【商务稿】\n{{steps.comm}}\n\n【合规校验】\n{{steps.comp}}" },
  ],
  assembly: [
    "# 投标文件 · 完整版",
    "",
    "## 第一部分 · 标书大纲与废标项自检(bid-lead 整合)",
    "",
    "{{steps.lead}}",
    "",
    "---",
    "",
    "## 第二部分 · 技术方案(正文,tech-writer)",
    "",
    "{{steps.tech}}",
    "",
    "---",
    "",
    "## 第三部分 · 商务 / 资质 / 报价(正文,commercial)",
    "",
    "{{steps.comm}}",
    "",
    "---",
    "",
    "## 附 · 合规校验与整改建议(compliance)",
    "",
    "{{steps.comp}}",
  ].join("\n"),
};

const contract: ScenarioDef = {
  id: "contract",
  title: "合同审查(法务红线)",
  blurb: "intake 提取 → 风险标注 → 红线 → 风险复核 → legal-lead 汇总",
  roles: [
    { name: "legal-lead", color: "#3b82f6", provider: "openai-codex", model: "gpt-5.5", purpose: "法务负责人:汇总审查意见书 + 谈判要点" },
    { name: "intake", color: "#8b5cf6", provider: "openai-codex", model: "gpt-5.5", purpose: "条款提取:结构化拆分合同条款" },
    { name: "risk-reviewer", color: "#ef4444", provider: "openai-codex", model: "gpt-5.5", purpose: "风险审查:对照 playbook 标风险等级" },
    { name: "redline-drafter", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "修订建议:对高风险条款出红线改法" },
  ],
  input: {
    label: "粘贴合同文本 / 关键条款…",
    default:
      "1. 付款:验收后90天内支付,逾期不计利息。\n2. 违约:乙方违约按合同总额30%赔偿,甲方违约无明确责任。\n3. 知识产权:乙方交付成果全部归甲方,含乙方既有底层框架。\n4. 终止:甲方可随时无理由终止且不承担费用。\n5. 保密:无期限、无例外。",
  },
  steps: [
    { id: "intake", role: "intake", after: [], prompt: "你是条款提取 intake。把下面合同拆成结构化条款清单(付款/违约/知识产权/终止/保密…),每条标注编号与原文要点,用 Markdown。\n\n合同:\n{{input}}" },
    { id: "risk", role: "risk-reviewer", after: ["intake"], prompt: "你是风险审查 risk-reviewer。对照通用法务 playbook,对下面每条条款标注风险等级(高/中/低)与理由,用 Markdown 表格。\n\n条款:\n{{steps.intake}}" },
    { id: "redline", role: "redline-drafter", after: ["risk"], prompt: "你是修订建议 redline-drafter。针对下面高/中风险条款给出「红线修改建议」(原文 → 建议改法 → 理由),用 Markdown。\n\n风险标注:\n{{steps.risk}}" },
    { id: "recheck", role: "risk-reviewer", after: ["redline"], prompt: "你是风险审查 risk-reviewer。复核下面的红线修改建议是否引入新风险或与其他条款冲突,逐条给出复核意见(通过/需调整 + 理由)。\n\n红线建议:\n{{steps.redline}}" },
    { id: "legal", role: "legal-lead", after: ["recheck"], prompt: "你是法务负责人 legal-lead。请汇总下面材料,输出最终「合同审查意见书 + 谈判要点」(Markdown),按风险优先级排列。\n\n条款:\n{{steps.intake}}\n\n风险:\n{{steps.risk}}\n\n红线:\n{{steps.redline}}\n\n复核:\n{{steps.recheck}}" },
  ],
  assembly: [
    "# 合同审查报告 · 完整版",
    "",
    "## 第一部分 · 审查意见书与谈判要点(legal-lead)",
    "",
    "{{steps.legal}}",
    "",
    "---",
    "",
    "## 第二部分 · 结构化条款(intake)",
    "",
    "{{steps.intake}}",
    "",
    "## 第三部分 · 风险标注(risk-reviewer)",
    "",
    "{{steps.risk}}",
    "",
    "## 第四部分 · 红线修改建议(redline-drafter)",
    "",
    "{{steps.redline}}",
    "",
    "## 第五部分 · 红线复核(risk-reviewer)",
    "",
    "{{steps.recheck}}",
  ].join("\n"),
};

export const SCENARIOS: ScenarioDef[] = [hierarchy, bid, contract];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/coms-dashboard && bun test src/lib/orchestration/scenarios.test.ts`
Expected: PASS(4 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/lib/orchestration/scenarios.ts apps/coms-dashboard/src/lib/orchestration/scenarios.test.ts
git commit -m "feat(orchestration): convert 3 built-in scenarios to ScenarioDef data"
```

---

### Task 6: 接线 ScenarioChat,删除 realScenarios.ts

**Files:**
- Modify: `apps/coms-dashboard/src/components/ScenarioChat.tsx`(全量替换为下方内容)
- Delete: `apps/coms-dashboard/src/lib/realScenarios.ts`

**说明:** 这是集成任务(无单元测试),靠 `bun test`(全套)+ `tsc` + 启动应用人工验证。关键改动:
1. 从 `../lib/orchestration/scenarios` 取 `SCENARIOS`,从 `../lib/orchestration/runScenario` 取 `runScenario`、`TIMEOUT_TEXT`,从 `../lib/orchestration/types` 取 `RoleDef`/`StepStatus`。
2. `ask` 不再自己追加禁止转发后缀(解释器统一加),超时返回 `TIMEOUT_TEXT`,签名变为 `(role, prompt, timeoutMs)`。
3. `spawnMissing(roles)` 封装现有 spawn + waitFor(只起缺失角色)。
4. `onSend` 调 `runScenario(sc, draft, {ask, spawnMissing, onStepUpdate, onStatus, onResult})`。
5. 视觉(分派药丸 / 角色气泡 / 状态 / 「📄 查看完整产出」弹窗)保持不变:仍由 store `lines`(`ask`→`send` 推送)驱动渲染;`onResult` → `setResult`;`onStatus` → `setStatus`;`onStepUpdate` 暂作轻量进度(可空实现)。

- [ ] **Step 1: 全量替换 ScenarioChat.tsx**

```tsx
// src/components/ScenarioChat.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import { SCENARIOS } from "../lib/orchestration/scenarios";
import { runScenario, TIMEOUT_TEXT } from "../lib/orchestration/runScenario";
import type { RoleDef } from "../lib/orchestration/types";

function StreamingMarkdown({ text, onTick }: { text: string; onTick?: () => void }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0;
    const total = text.length;
    const step = Math.max(2, Math.ceil(total / 90));
    const t = setInterval(() => {
      i = Math.min(total, i + step);
      setShown(text.slice(0, i));
      onTick?.();
      if (i >= total) clearInterval(t);
    }, 28);
    return () => clearInterval(t);
  }, [text]);
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown || ""}</ReactMarkdown>
      {shown.length < text.length && <span className="chat-caret" />}
    </div>
  );
}

export function ScenarioChat() {
  const agents = useStore((s) => s.agents);
  const lines = useStore((s) => s.lines);
  const send = useStore((s) => s.send);
  const [sid, setSid] = useState(SCENARIOS[0].id);
  const sc = useMemo(() => SCENARIOS.find((x) => x.id === sid)!, [sid]);
  const [draft, setDraft] = useState(SCENARIOS[0].input.default);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const agentNames = useMemo(() => new Set(Object.values(agents).map((a) => a.name)), [agents]);
  const allOnline = sc.roles.every((r) => agentNames.has(r.name));

  const thread = useMemo(() => {
    const roleSet = new Set(sc.roles.map((r) => r.name));
    return lines.filter(
      (l) =>
        (l.from === "dashboard" && !!l.to && roleSet.has(l.to)) ||
        ((l.kind === "response" || l.kind === "error") && l.to === "dashboard" && roleSet.has(l.from)),
    );
  }, [lines, sc]);
  const last = thread[thread.length - 1];
  const pendingTo = busy && last && last.from === "dashboard" ? last.to : null;
  const scrollToBottom = () => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { scrollToBottom(); }, [thread.length]);

  function pick(id: string) {
    setSid(id);
    const s = SCENARIOS.find((x) => x.id === id)!;
    setDraft(s.input.default);
    setStatus("");
    setResult(null);
  }

  function spawnOne(r: RoleDef) {
    return fetch("/spawner/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: r.name, provider: r.provider, model: r.model, color: r.color, purpose: r.purpose }),
    });
  }
  function waitFor(names: string[], timeoutMs = 50000) {
    return new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const cur = Object.values(useStore.getState().agents).map((x) => x.name);
        if (names.every((n) => cur.includes(n))) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(false); }
      }, 1000);
    });
  }
  async function spawnMissing(roles: RoleDef[]): Promise<boolean> {
    const online = new Set(Object.values(useStore.getState().agents).map((a) => a.name));
    const missing = roles.filter((r) => !online.has(r.name));
    if (missing.length === 0) return true;
    setStatus(`启动 ${missing.map((r) => r.name).join(" / ")}…`);
    try { await Promise.all(missing.map(spawnOne)); }
    catch { setStatus("spawner 未运行 — 先在终端跑 just spawner"); return false; }
    setStatus("等待 agent 注册…(约 10–25s)");
    return waitFor(missing.map((r) => r.name));
  }

  // 按 msg_id 关联:发出后只认这条 msg_id 的回复(对多面板/历史鲁棒)。超时 resolve TIMEOUT_TEXT。
  async function ask(role: string, prompt: string, timeoutMs: number): Promise<string> {
    const msgId = await send(role, prompt);
    if (!msgId) return "(发送失败:hub 未接受消息)";
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = useStore.getState().lines.find(
          (l) => l.msg_id === msgId && (l.kind === "response" || l.kind === "error"),
        );
        if (hit) { clearInterval(iv); resolve(hit.text); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(TIMEOUT_TEXT); }
      }, 600);
    });
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setResult(null);
    try {
      await runScenario(sc, text, {
        ask,
        spawnMissing,
        onStepUpdate: () => {},
        onStatus: setStatus,
        onResult: setResult,
      });
    } finally { setBusy(false); }
  }
  async function stop() {
    setStatus("停止本场景 agent…");
    try {
      const listResp = await (await fetch("/spawner/list")).json();
      const re = new RegExp("^pi-(" + sc.roles.map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")-");
      const targets: string[] = (listResp.sessions || []).filter((s: string) => re.test(s));
      await Promise.all(targets.map((s) => fetch("/spawner/kill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: s }) })));
      setStatus(`已停止 ${targets.length} 个 agent`);
    } catch { setStatus("spawner 未运行"); }
  }

  return (
    <aside className="rail-chat">
      <div className="chat-head">
        <select value={sid} onChange={(e) => pick(e.target.value)}>
          {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        {result && <button className="result-open" onClick={() => setShowResult(true)}>📄 查看完整产出</button>}
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      <div className="chat-roles">{sc.blurb} · {allOnline ? "角色在线 ✓" : `角色:${sc.roles.map((r) => r.name).join(" / ")}`}</div>
      <div className="chat-body" ref={bodyRef}>
        {thread.length === 0 && <div className="chat-empty">选择场景,在下方填入任务并运行 → 面板按步骤把任务分派给每个角色,中间产出与最终整合都会在这里逐条流式显示(Markdown 渲染)。</div>}
        {thread.map((l) => {
          if (l.from === "dashboard") {
            return <div key={l.id} className="chat-dispatch">↳ 分派给 <b>{l.to}</b></div>;
          }
          return (
            <div key={l.id} className="chat-msg assistant peer">
              <div className="chat-role">{l.from}</div>
              <StreamingMarkdown text={l.text} onTick={scrollToBottom} />
            </div>
          );
        })}
        {pendingTo && (
          <div className="chat-msg assistant peer">
            <div className="chat-role">{pendingTo}</div>
            <div className="chat-md chat-thinking"><span /><span /><span /></div>
          </div>
        )}
        {status && <div className="chat-status">{status}</div>}
      </div>
      <div className="chat-composer">
        <textarea
          value={draft}
          placeholder={sc.input.label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend(); }}
        />
        <button className="send-btn" disabled={busy || !draft.trim()} onClick={onSend}>
          {busy ? "运行中…" : allOnline ? "运行编排 ⌘↵" : "▶ 启动并运行"}
        </button>
      </div>
      {showResult && result && (
        <div className="result-backdrop" onClick={() => setShowResult(false)}>
          <div className="result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="result-head">
              <strong>{sc.title} · 完整产出</strong>
              <span className="result-sub">面板按角色真实正文无损装配</span>
              <button className="result-copy" onClick={() => navigator.clipboard?.writeText(result)}>复制全文</button>
              <button className="result-close" onClick={() => setShowResult(false)}>✕</button>
            </div>
            <div className="result-body">
              <div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
```

> 注:上面把 lead 气泡的「· 最终整合」蓝条样式简化掉了(原 `chat-msg.lead`)。若要保留,把渲染分支改为依据「该 role 是否为某汇点 step 的 role」加 `lead` class;此为可选美化,不影响功能。本任务先不做,保持气泡统一为 `peer`。

- [ ] **Step 2: 删除旧文件**

```bash
git rm apps/coms-dashboard/src/lib/realScenarios.ts
```

- [ ] **Step 3: 校验类型 + 全套单测**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && bun test src/lib/orchestration/`
Expected: tsc 无输出;`bun test` 全绿(template 6 + validate 7 + runScenario 7 + scenarios 4 = 24 通过)。

- [ ] **Step 4: 确认没有别处还在 import realScenarios**

Run: `cd apps/coms-dashboard && grep -rn "realScenarios" src/ || echo "no refs"`
Expected: `no refs`。

- [ ] **Step 5: 启动应用人工验证(真实回归)**

前置(各自终端):
```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server
just spawner
cd apps/coms-dashboard && bun run dev
```
在 http://localhost:5273:
- 选「层级编排」→ 运行 → 应依次出现 `↳ 分派给 lead-a` `↳ 分派给 lead-b` → 两个真实回答气泡 → `↳ 分派给 boss` → boss 综合 → 状态「完成 ✓」→ 点「📄 查看完整产出」看到装配结果。
- 控制台 0 报错(favicon 404 可忽略)。

Expected: 行为与改造前一致。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioChat.tsx
git commit -m "refactor(orchestration): drive ScenarioChat via data-driven interpreter; remove realScenarios"
```

---

## 验证「配置即编排」(完成判据演示)

无需写任何 TS 逻辑,仅在 `scenarios.ts` 的 `SCENARIOS` 数组里追加一个纯数据场景即可运行。示例(两步串行,可加到数组验证后再决定是否保留):

```ts
const echo: ScenarioDef = {
  id: "echo", title: "回声(验证)", blurb: "a 起草 → b 校对",
  roles: [
    { name: "lead-a", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "起草" },
    { name: "lead-b", color: "#f59e0b", provider: "openai-codex", model: "gpt-5.5", purpose: "校对" },
  ],
  input: { label: "主题…", default: "用一句话介绍多 Agent 编排" },
  steps: [
    { id: "draft", role: "lead-a", prompt: "起草:{{input}}", after: [] },
    { id: "review", role: "lead-b", prompt: "校对并改进:{{steps.draft}}", after: ["draft"] },
  ],
  // 无 assembly → 缺省取汇点 review 的产出
};
```

加入后下拉即出现「回声(验证)」,运行得到真实两步产出。**证明:加场景=改数据,无需碰编排逻辑。** 验证完可移除该示例。

---

## Self-Review(已执行)

- **Spec 覆盖:** 数据模型→Task1;模板引擎(render/collectRefs)→Task2;校验器(id/role/after/模板/环)→Task3;解释器(拓扑/并行/超时传播/装配/禁止转发后缀)→Task4;3 场景转数据→Task5;ScenarioChat 接线 + 删 realScenarios→Task6;「配置即编排」完成判据→末节演示。无遗漏。
- **占位符扫描:** 无 TBD/TODO;每个代码步骤含完整代码;每个测试步骤含完整断言。
- **类型一致性:** `RoleDef/StepDef/ScenarioDef/StepStatus/RunDeps`(Task1)在 Task3/4/5/6 中签名一致;`runScenario(s, input, deps)`、`assemble(s, outputs)`、`render(tpl, {input, steps})`、`collectRefs(tpl)`、`validate(s)`、常量 `TIMEOUT_TEXT`/`DELEGATION_SUFFIX` 在测试与实现间一致;`send` 返回 `Promise<string|null>`(已在前序提交 5fc5298 实现)被 Task6 的 `ask` 使用,一致。
