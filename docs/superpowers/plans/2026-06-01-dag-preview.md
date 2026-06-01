# 可视化 DAG 预览(子项目 F2)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在 `ScenarioEditor` 里嵌一块实时只读 DAG 图(节点=步骤、边=after),点节点跳到对应步骤表单行;编辑仍走表单。

**Architecture:** 纯函数 `scenarioToGraph`(可单测)+ `ScenarioDagPreview`(复用 AntV G6,只读,延迟 destroy 生命周期)+ `ScenarioEditor` 内嵌折叠面板。无新依赖。

**Tech Stack:** React + Vite + TS;AntV G6 v5.1.1(已是依赖);`bun test`。

**Spec:** `docs/superpowers/specs/2026-06-01-dag-preview-design.md`
**Branch:** `main`
**工作目录:** `cd apps/coms-dashboard`。参考 `src/components/FlowGraph.tsx` 的 G6 v5 用法。

---

### Task 1: 纯函数 `scenarioToGraph`

**Files:** Create `src/lib/scenarioGraph.ts`、`src/lib/scenarioGraph.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/scenarioGraph.test.ts
import { expect, test } from "bun:test";
import { scenarioToGraph } from "./scenarioGraph";
import type { ScenarioDef } from "./orchestration/types";

function scn(steps: ScenarioDef["steps"]): ScenarioDef {
  return { id: "s", title: "t", blurb: "b", roles: [{ name: "r", provider: "p", model: "m", purpose: "", color: "#000" }], input: { label: "", default: "" }, steps };
}

test("空 steps → 空图", () => {
  expect(scenarioToGraph(scn([]))).toEqual({ nodes: [], edges: [] });
});

test("steps + after → nodes/edges", () => {
  const g = scenarioToGraph(scn([
    { id: "a", role: "r", prompt: "", after: [] },
    { id: "b", role: "r", prompt: "", after: ["a"] },
  ]));
  expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  expect(g.nodes.find((n) => n.id === "a")!.label).toContain("a");
  expect(g.edges).toEqual([{ source: "a", target: "b" }]);
});

test("坏 after 引用(指向不存在 step)→ 不产出该边", () => {
  const g = scenarioToGraph(scn([{ id: "a", role: "r", prompt: "", after: ["ghost"] }]));
  expect(g.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(g.edges).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test src/lib/scenarioGraph.test.ts`
Expected: FAIL — `Cannot find module './scenarioGraph'`。

- [ ] **Step 3: 写实现**

```ts
// src/lib/scenarioGraph.ts
import type { ScenarioDef } from "./orchestration/types";

export interface DagNode { id: string; label: string; }
export interface DagEdge { source: string; target: string; }

export function scenarioToGraph(s: ScenarioDef): { nodes: DagNode[]; edges: DagEdge[] } {
  const ids = new Set(s.steps.map((st) => st.id));
  const nodes: DagNode[] = s.steps.map((st) => ({ id: st.id, label: st.role ? `${st.id} · ${st.role}` : st.id }));
  const edges: DagEdge[] = [];
  for (const st of s.steps) {
    for (const dep of st.after ?? []) {
      if (ids.has(dep) && dep !== st.id) edges.push({ source: dep, target: st.id });
    }
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test src/lib/scenarioGraph.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/lib/scenarioGraph.ts apps/coms-dashboard/src/lib/scenarioGraph.test.ts
git commit -m "feat(web): scenarioToGraph (ScenarioDef → DAG nodes/edges)"
```

---

### Task 2: `ScenarioDagPreview` 组件 + 样式

**Files:** Create `src/components/ScenarioDagPreview.tsx`;Modify `src/styles.css`

- [ ] **Step 1: 写组件**

```tsx
// src/components/ScenarioDagPreview.tsx
import { useEffect, useRef } from "react";
import { Graph, NodeEvent, type GraphData } from "@antv/g6";
import type { ScenarioDef } from "../lib/orchestration/types";
import { scenarioToGraph } from "../lib/scenarioGraph";

function toG6Data(s: ScenarioDef): GraphData {
  const { nodes, edges } = scenarioToGraph(s);
  return {
    nodes: nodes.map((n) => ({ id: n.id, data: { label: n.label } })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

export function ScenarioDagPreview({ scenario, onPickStep }: { scenario: ScenarioDef; onPickStep?: (id: string) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const pickRef = useRef(onPickStep);
  pickRef.current = onPickStep;

  // 创建一次
  useEffect(() => {
    const container = boxRef.current;
    if (!container) return;
    const graph = new Graph({
      container,
      data: toG6Data(scenario),
      animation: false,
      layout: { type: "antv-dagre", rankdir: "TB", nodesep: 18, ranksep: 30 },
      node: {
        type: "rect",
        style: {
          size: [120, 28], radius: 6,
          fill: "#eff6ff", stroke: "#3b82f6", lineWidth: 1,
          labelText: (d: any) => String(d.data?.label ?? d.id), labelFill: "#1e3a8a", labelFontSize: 11, labelPlacement: "center",
        },
      },
      edge: { type: "polyline", style: { stroke: "#94a3b8", lineWidth: 1, endArrow: true, endArrowSize: 6 } },
      behaviors: ["drag-canvas", "zoom-canvas"],
      padding: 16,
    });
    graph.on(NodeEvent.CLICK, (evt: any) => {
      const id = evt?.target?.id;
      if (id && pickRef.current) pickRef.current(String(id));
    });
    graphRef.current = graph;
    const rendered = graph.render().catch(() => {});
    return () => {
      graphRef.current = null;
      void rendered.finally(() => { try { graph.destroy(); } catch { /* already destroyed */ } });
    };
    // 仅创建一次;数据更新在下面 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 场景变 → 重置数据并重画
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    g.setData(toG6Data(scenario));
    g.render().then(() => { if (!g.destroyed) g.fitView({ when: "always" }); }).catch(() => {});
  }, [scenario]);

  return <div className="dag-preview" ref={boxRef} />;
}
```

- [ ] **Step 2: 样式(追加 styles.css)**

```css
.dag-preview { width: 100%; height: 200px; border: 1px solid var(--hairline-soft); border-radius: 10px; background: var(--muted-surface); overflow: hidden; }
.dag-collapse { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--text); border-top: 1px solid var(--hairline-soft); padding-top: 8px; margin-top: 6px; cursor: pointer; user-select: none; }
.editor-step.flash { animation: step-flash 1.2s ease-out; }
@keyframes step-flash { 0% { box-shadow: 0 0 0 2px var(--primary); } 100% { box-shadow: none; } }
```

- [ ] **Step 3: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出（G6 类型用 `any` 规避;若报 `behaviors`/`labelPlacement` 类型不符,改用 `as any` 包裹对应配置)。

- [ ] **Step 4: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioDagPreview.tsx apps/coms-dashboard/src/styles.css
git commit -m "feat(web): read-only DAG preview (G6) for scenario editor"
```

---

### Task 3: 接入 `ScenarioEditor`(折叠面板 + 点节点跳步骤)

**Files:** Modify `src/components/ScenarioEditor.tsx`

- [ ] **Step 1: import + 状态 + pickStep**

import 顶部加:
```tsx
import { ScenarioDagPreview } from "./ScenarioDagPreview";
```
组件内(状态区)加:
```tsx
  const [showDag, setShowDag] = useState(true);
  function pickStep(id: string) {
    const el = document.querySelector(`[data-step-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }
```

- [ ] **Step 2: 给每个步骤行加 `data-step-id`**

把 `{s.steps.map((st, i) => (` 那行的 `<div key={i} className="editor-step">` 改为:
```tsx
            <div key={i} className="editor-step" data-step-id={st.id}>
```

- [ ] **Step 3: 在「步骤(DAG)」section 之上插入折叠的 DAG 预览**

在 `<div className="editor-section"><span>步骤(DAG)</span>…</div>` 之前加:
```tsx
          <div className="dag-collapse" onClick={() => setShowDag((v) => !v)}>{showDag ? "▾" : "▸"} 依赖图预览</div>
          {showDag && <ScenarioDagPreview scenario={s} onPickStep={pickStep} />}
```

- [ ] **Step 4: 验证编译 + 全套测试 + build**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && bun test && bun run build`
Expected: tsc 无输出;`bun test` 全绿(84 + scenarioGraph 3 = 87);build 成功。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioEditor.tsx
git commit -m "feat(web): embed DAG preview in scenario editor + node→step jump"
```

---

### Task 4: 浏览器人工验收

- [ ] **Step 1:** 起 hub+server+dev,登录 → 新建场景 → 加 3 步、连依赖(comp after a,b)→ 顶部「依赖图预览」实时长出有向图;点图中某节点 → 对应步骤表单行滚动到视区并闪一下;折叠/展开开关正常;造环(a after b、b after a)→ 表单红条拦截、图不崩;反复开关编辑器无 G6 控制台报错。

---

## Self-Review(已执行)

- **Spec 覆盖:** F2.1 scenarioToGraph → Task 1;F2.2 ScenarioDagPreview(G6 只读 + 延迟 destroy + NodeEvent.CLICK)→ Task 2;F2.3 接入(折叠面板 + data-step-id + pickStep 滚动高亮)→ Task 3;F2.4 错误/边界(坏引用不产边、环不崩、生命周期)→ Task 1(纯)+ Task 2(守卫)+ Task 4(验收);F2.5 测试 → Task 1 + Task 4;完成判据 → Task 4。
- **占位符扫描:** 无 TBD;组件/CSS/测试完整。G6 类型用 `any` 规避(注明备选 `as any`)。
- **类型一致性:** `scenarioToGraph(s) → {nodes:{id,label}[],edges:{source,target}[]}`(Task 1)被 `toG6Data`(Task 2)消费;`ScenarioDagPreview` props `{scenario,onPickStep}`(Task 2)与 ScenarioEditor 渲染(Task 3)一致;`data-step-id` 选择器与渲染属性一致;复用 G6 v5(`Graph`/`NodeEvent`,同 FlowGraph)。
- **已知取舍:** 只读预览(非拖拽编辑);G6 类型宽松用 `any`(与 FlowGraph 一致风格);组件靠 tsc + 浏览器验收,纯逻辑 `scenarioGraph` 单测。
