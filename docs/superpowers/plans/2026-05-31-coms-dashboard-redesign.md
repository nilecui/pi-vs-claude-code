# coms-dashboard 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/coms-dashboard` 重构成三栏布局(加 agent 命令生成器 | AntV G6 关系图 | 可折叠日志栏),节点可点开设置、agent 可编排式互发。

**Architecture:** 只改视图层 + 一个 store action;数据层(SSE/hub client/types)不动。纯逻辑(命令生成、编排 prompt)抽成 `lib/` 纯函数并用 `bun test` 做 TDD;React 组件用浏览器 DOM/computed-style 断言验证(本仓库既有方式)。图库从 reactflow 换成 `@antv/g6@^5`。

**Tech Stack:** React 18 + Vite + TypeScript + Zustand + AntV G6 v5;`bun` 包管理与测试;浅色设计系统(`src/styles.css`)。

---

## File Structure

新增:
- `apps/coms-dashboard/src/lib/launchCommand.ts` — 表单值 → 启动命令字符串(纯函数)
- `apps/coms-dashboard/src/lib/launchCommand.test.ts`
- `apps/coms-dashboard/src/lib/orchestratePrompt.ts` — 编排 prompt 模板(纯函数)
- `apps/coms-dashboard/src/lib/orchestratePrompt.test.ts`
- `apps/coms-dashboard/src/components/AddAgentForm.tsx`
- `apps/coms-dashboard/src/components/AgentList.tsx`
- `apps/coms-dashboard/src/components/FlowGraph.tsx` — G6 图
- `apps/coms-dashboard/src/components/NodePanel.tsx`
- `apps/coms-dashboard/src/components/InteractionComposer.tsx`
- `apps/coms-dashboard/src/components/LogRail.tsx`

修改:
- `apps/coms-dashboard/package.json` — 依赖增删
- `apps/coms-dashboard/src/store.ts` — 加 `orchestrate` action
- `apps/coms-dashboard/src/App.tsx` — 三栏骨架
- `apps/coms-dashboard/src/styles.css` — 新区域样式

删除:
- `apps/coms-dashboard/src/components/Sidebar.tsx`
- `apps/coms-dashboard/src/components/GraphView.tsx`

保留不动:`api/hub.ts`、`types.ts`、`components/TerminalCard.tsx`、`main.tsx`。

> 所有命令默认在 `apps/coms-dashboard/` 目录下执行。

---

## Task 1: 依赖切换(移除 reactflow,加 G6)

**Files:**
- Modify: `apps/coms-dashboard/package.json`

- [ ] **Step 1: 装 G6、卸 reactflow**

Run:
```bash
cd apps/coms-dashboard
bun remove reactflow
bun add @antv/g6@^5
```

- [ ] **Step 2: 确认安装**

Run: `bun pm ls | grep -E "@antv/g6|reactflow"`
Expected: 列出 `@antv/g6@5.x`,**无** `reactflow`。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/package.json apps/coms-dashboard/bun.lock
git commit -m "deps: swap reactflow for @antv/g6 in coms-dashboard"
```

---

## Task 2: `launchCommand` 纯函数(TDD)

把表单值拼成真实可运行的启动命令。已对 `extensions/coms-net.ts` flag(`--name/--purpose/--project/--color/--explicit`)与 Pi 核心 flag(`--provider/--model`)核实。

**Files:**
- Create: `apps/coms-dashboard/src/lib/launchCommand.ts`
- Test: `apps/coms-dashboard/src/lib/launchCommand.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/coms-dashboard/src/lib/launchCommand.test.ts`:
```ts
import { expect, test } from "bun:test";
import { launchCommand } from "./launchCommand";

test("name only → just coms", () => {
  expect(launchCommand({ name: "alice" })).toBe("just coms --name alice");
});

test("provider + model passthrough", () => {
  expect(launchCommand({ name: "alice", provider: "openai", model: "gpt-5.5" }))
    .toBe('just coms --name alice --provider openai --model gpt-5.5');
});

test("purpose with spaces is quoted", () => {
  expect(launchCommand({ name: "bob", purpose: "Prod gatekeeper" }))
    .toBe('just coms --name bob --purpose "Prod gatekeeper"');
});

test("color flag", () => {
  expect(launchCommand({ name: "c", color: "#10b981" }))
    .toBe('just coms --name c --color "#10b981"');
});

test("default project omitted, custom project included", () => {
  expect(launchCommand({ name: "a", project: "default" })).toBe("just coms --name a");
  expect(launchCommand({ name: "a", project: "team-x" }))
    .toBe("just coms --name a --project team-x");
});

test("explicit is a valueless flag", () => {
  expect(launchCommand({ name: "a", explicit: true }))
    .toBe("just coms --name a --explicit");
});

test("cwd prefixes a cd", () => {
  expect(launchCommand({ name: "a", cwd: "/tmp/work" }))
    .toBe("cd /tmp/work && just coms --name a");
});

test("bare form emits pi -e with extension paths", () => {
  expect(launchCommand({ name: "a", bare: true }))
    .toBe("pi -e extensions/coms-net.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts --name a");
});

test("embedded double-quote in purpose is escaped", () => {
  expect(launchCommand({ name: "a", purpose: 'say "hi"' }))
    .toBe('just coms --name a --purpose "say \\"hi\\""');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/lib/launchCommand.test.ts`
Expected: FAIL — `Cannot find module './launchCommand'`。

- [ ] **Step 3: 实现**

`apps/coms-dashboard/src/lib/launchCommand.ts`:
```ts
export interface AgentLaunchSpec {
  name: string;
  provider?: string;
  model?: string;
  purpose?: string;
  color?: string;
  project?: string;
  explicit?: boolean;
  cwd?: string;
  /** true → emit bare `pi -e …` (runs in any cwd); false → `just coms` (repo root). */
  bare?: boolean;
}

const BARE_BASE =
  "pi -e extensions/coms-net.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts";

/** Double-quote a value if it contains anything outside a safe shell-word set. */
function q(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function launchCommand(spec: AgentLaunchSpec): string {
  const args: string[] = ["--name", q(spec.name)];
  if (spec.provider) args.push("--provider", q(spec.provider));
  if (spec.model) args.push("--model", q(spec.model));
  if (spec.purpose) args.push("--purpose", q(spec.purpose));
  if (spec.color) args.push("--color", q(spec.color));
  if (spec.project && spec.project !== "default") args.push("--project", q(spec.project));
  if (spec.explicit) args.push("--explicit");

  const base = spec.bare ? BARE_BASE : "just coms";
  const cmd = `${base} ${args.join(" ")}`;
  return spec.cwd ? `cd ${q(spec.cwd)} && ${cmd}` : cmd;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/lib/launchCommand.test.ts`
Expected: PASS（9 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/launchCommand.ts src/lib/launchCommand.test.ts
git commit -m "feat(coms-dashboard): launchCommand builder for add-agent form"
```

---

## Task 3: `orchestratePrompt` 纯函数(TDD)

**Files:**
- Create: `apps/coms-dashboard/src/lib/orchestratePrompt.ts`
- Test: `apps/coms-dashboard/src/lib/orchestratePrompt.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/coms-dashboard/src/lib/orchestratePrompt.test.ts`:
```ts
import { expect, test } from "bun:test";
import { orchestratePrompt } from "./orchestratePrompt";

test("mentions target name and task", () => {
  const p = orchestratePrompt("bob", "ask for the API spec");
  expect(p).toContain('"bob"');
  expect(p).toContain("ask for the API spec");
});

test("includes an anti-loop termination instruction", () => {
  const p = orchestratePrompt("bob", "x");
  expect(p.toLowerCase()).toContain("do not loop");
});

test("tells the agent to report back", () => {
  expect(orchestratePrompt("bob", "x").toLowerCase()).toContain("report");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/lib/orchestratePrompt.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 实现**

`apps/coms-dashboard/src/lib/orchestratePrompt.ts`:
```ts
/** Builds the prompt the dashboard sends to agent A so A contacts agent B itself
 *  (orchestrate-via-prompt; no impersonation). Includes an anti-loop guard. */
export function orchestratePrompt(toName: string, task: string): string {
  return [
    `Use your coms tool to message agent "${toName}".`,
    `Task: ${task}`,
    `When you have the answer, report the conclusion back to me directly.`,
    `Do not loop indefinitely with ${toName} — keep it to the minimum exchanges needed, then stop.`,
  ].join("\n");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/lib/orchestratePrompt.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestratePrompt.ts src/lib/orchestratePrompt.test.ts
git commit -m "feat(coms-dashboard): orchestratePrompt template with anti-loop guard"
```

---

## Task 4: store `orchestrate` action

**Files:**
- Modify: `apps/coms-dashboard/src/store.ts`

- [ ] **Step 1: 在 `State` 接口加方法签名**

在 `store.ts` 的 `interface State` 中,`send` 之后加一行:
```ts
  orchestrate: (fromName: string, toName: string, task: string) => Promise<void>;
```

- [ ] **Step 2: 引入纯函数**

在 `store.ts` 顶部 import 区(`import type { AgentCard, ... }` 附近)加:
```ts
import { orchestratePrompt } from "./lib/orchestratePrompt";
```

- [ ] **Step 3: 实现 action**

在返回对象里,`async send(...) {...},` 之后加(与 `send` 同级,可复用闭包内的 `pulse`/`pushLine`/`nextId`/`sessionByName`):
```ts
    async orchestrate(fromName, toName, task) {
      const client = get().client;
      if (!client) return;
      const agents = get().agents;
      const fromSession = sessionByName(agents, fromName) ?? fromName;
      const toSession = sessionByName(agents, toName) ?? toName;
      pulse(fromSession, toSession, "prompt");
      pushLine(
        { id: nextId(), ts: Date.now(), kind: "prompt", from: fromName, to: toName, text: `(orchestrate) ${task}` },
        fromSession in agents ? fromSession : undefined,
      );
      try {
        await client.send(fromName, orchestratePrompt(toName, task));
      } catch (err) {
        pushLine({ id: nextId(), ts: Date.now(), kind: "error", from: "hub", text: `orchestrate failed: ${err}` });
      }
    },
```

- [ ] **Step 4: 类型检查**

Run: `bunx tsc -b`
Expected: 无错误（`orchestrate` 已满足 `State`）。

- [ ] **Step 5: Commit**

```bash
git add src/store.ts
git commit -m "feat(coms-dashboard): store.orchestrate (prompt A to contact B)"
```

---

## Task 5: AddAgentForm 组件

**Files:**
- Create: `apps/coms-dashboard/src/components/AddAgentForm.tsx`
- Modify: `apps/coms-dashboard/src/styles.css`(追加,见 Task 11)

- [ ] **Step 1: 实现组件**

`apps/coms-dashboard/src/components/AddAgentForm.tsx`:
```tsx
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { launchCommand, type AgentLaunchSpec } from "../lib/launchCommand";

const PRESETS: Record<string, { provider?: string; model?: string }> = {
  "gpt-5.5": { provider: "openai", model: "gpt-5.5" },
  "claude-opus-4-7": { model: "claude-opus-4-7" },
  "deepseek/deepseek-v4-pro": { model: "deepseek/deepseek-v4-pro" },
  "z-ai/glm-5.1": { model: "z-ai/glm-5.1" },
  custom: {},
};

export function AddAgentForm() {
  const agents = useStore((s) => s.agents);
  const names = useMemo(
    () => new Set(Object.values(agents).map((a) => a.name)),
    [agents],
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("gpt-5.5");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [color, setColor] = useState("");
  const [bare, setBare] = useState(false);
  const [copied, setCopied] = useState(false);

  const dup = name.trim().length > 0 && names.has(name.trim());
  const sel = PRESETS[preset];
  const spec: AgentLaunchSpec = {
    name: name.trim() || "agent",
    provider: preset === "custom" ? provider.trim() || undefined : sel.provider,
    model: preset === "custom" ? model.trim() || undefined : sel.model,
    purpose: purpose.trim() || undefined,
    color: color.trim() || undefined,
    bare,
  };
  const command = launchCommand(spec);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      window.prompt("Copy the launch command:", command);
    }
  }

  return (
    <div className="add-agent">
      <button className="add-agent-toggle" onClick={() => setOpen((o) => !o)}>
        + Add Agent
      </button>
      {open && (
        <div className="add-agent-body">
          <label className="field">
            <span>name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="alice" />
          </label>
          {dup && <div className="field-err">name already in pool</div>}

          <label className="field">
            <span>model</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.keys(PRESETS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          {preset === "custom" && (
            <div className="field-row">
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="provider" />
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" />
            </div>
          )}

          <label className="field">
            <span>purpose</span>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Prod gatekeeper…" />
          </label>
          <label className="field">
            <span>color</span>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#10b981" />
          </label>
          <label className="field-check">
            <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
            <span>裸 pi -e 形式(任意目录可运行)</span>
          </label>

          <div className="cmd-preview">
            <code>{command}</code>
          </div>
          <button className="send-btn" disabled={!name.trim() || dup} onClick={copy}>
            {copied ? "Copied ✓" : "Copy command"}
          </button>
          <div className="add-agent-hint">在仓库根目录的终端里粘贴运行,agent 注册后会出现在池中。</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `bunx tsc -b`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/AddAgentForm.tsx
git commit -m "feat(coms-dashboard): AddAgentForm launch-command generator"
```

---

## Task 6: AgentList 组件

把原 `Sidebar` 的 agent 列表抽出来。

**Files:**
- Create: `apps/coms-dashboard/src/components/AgentList.tsx`

- [ ] **Step 1: 实现组件**

`apps/coms-dashboard/src/components/AgentList.tsx`:
```tsx
import { useMemo } from "react";
import { useStore } from "../store";

export function AgentList() {
  const agents = useStore((s) => s.agents);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);

  const list = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  return (
    <div className="agent-list">
      <div className="section-label">agents · {list.length}</div>
      {list.length === 0 && (
        <div className="muted">No agents online. Add one above, or run <code>just coms</code>.</div>
      )}
      {list.map((a) => (
        <button
          key={a.session_id}
          className={`agent-row ${selected === a.session_id ? "sel" : ""}`}
          onClick={() => select(a.session_id)}
        >
          <span className="dot" style={{ background: a.color }} />
          <div className="agent-row-main">
            <div className="agent-row-name">
              {a.name} <span className={`badge b-${a.status}`}>{a.status}</span>
            </div>
            <div className="agent-row-model">{a.model}</div>
            <div className="ctx-bar sm"><div className="ctx-fill" style={{ width: `${Math.min(100, a.context_used_pct)}%` }} /></div>
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `bunx tsc -b`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/AgentList.tsx
git commit -m "feat(coms-dashboard): AgentList (extracted from Sidebar)"
```

---

## Task 7: FlowGraph 组件(AntV G6)

**Files:**
- Create: `apps/coms-dashboard/src/components/FlowGraph.tsx`
- Delete: `apps/coms-dashboard/src/components/GraphView.tsx`

- [ ] **Step 1: 实现组件**

`apps/coms-dashboard/src/components/FlowGraph.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { Graph, NodeEvent, type GraphData } from "@antv/g6";
import { DASHBOARD_ID, useStore } from "../store";

const FLOW_COLOR: Record<string, string> = {
  prompt: "#3b82f6",
  response: "#10b981",
  error: "#ef4444",
};

const LAYOUTS: Record<string, Record<string, unknown>> = {
  force: { type: "d3-force", collide: { radius: 60 } },
  radial: { type: "radial", unitRadius: 170, linkDistance: 170 },
  dagre: { type: "antv-dagre", rankdir: "LR", nodesep: 24, ranksep: 120 },
  tree: { type: "antv-dagre", rankdir: "TB", nodesep: 30, ranksep: 80 },
};
type LayoutKey = keyof typeof LAYOUTS;

function buildData(
  agents: ReturnType<typeof useStore.getState>["agents"],
  flows: ReturnType<typeof useStore.getState>["flows"],
): GraphData {
  const list = Object.values(agents).filter((a) => !a.explicit);
  const nodes: GraphData["nodes"] = [
    { id: DASHBOARD_ID, data: { label: "◆ control panel", dashboard: true, color: "#3b82f6" } },
  ];
  for (const a of list) {
    nodes.push({
      id: a.session_id,
      data: { label: `${a.name}\n${a.model}`, color: a.color, status: a.status },
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphData["edges"] = list.map((a) => ({
    id: `base-${a.session_id}`,
    source: DASHBOARD_ID,
    target: a.session_id,
    data: { color: "#e2e8f0" },
  }));
  for (const f of flows) {
    if (!ids.has(f.from) || !ids.has(f.to)) continue;
    edges.push({
      id: `flow-${f.id}`,
      source: f.from,
      target: f.to,
      data: { color: FLOW_COLOR[f.kind] ?? "#3b82f6", pulse: true },
    });
  }
  return { nodes, edges };
}

export function FlowGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const agents = useStore((s) => s.agents);
  const flows = useStore((s) => s.flows);
  const select = useStore((s) => s.select);
  const [layout, setLayout] = useState<LayoutKey>("force");

  // Create once.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      autoFit: "center",
      data: buildData(useStore.getState().agents, useStore.getState().flows),
      layout: LAYOUTS.force,
      node: {
        type: "rect",
        style: {
          size: [150, 50],
          radius: 12,
          fill: "#ffffff",
          stroke: (d: any) => d.data?.color ?? "#e2e8f0",
          lineWidth: (d: any) => (d.data?.dashboard ? 2 : 1.5),
          labelText: (d: any) => d.data?.label ?? d.id,
          labelFill: "#0f172a",
          labelFontSize: 11,
          labelFontWeight: 600,
          labelPlacement: "center",
          opacity: (d: any) => (d.data?.status === "offline" ? 0.4 : d.data?.status === "stale" ? 0.65 : 1),
        },
      },
      edge: {
        style: {
          stroke: (d: any) => d.data?.color ?? "#e2e8f0",
          lineWidth: (d: any) => (d.data?.pulse ? 2.5 : 1.5),
          endArrow: (d: any) => !!d.data?.pulse,
        },
      },
      behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    });
    graph.on(NodeEvent.CLICK, (evt: any) => {
      const id = evt.target?.id;
      if (id && id !== DASHBOARD_ID) select(id);
    });
    graph.render();
    graphRef.current = graph;
    return () => {
      graph.destroy();
      graphRef.current = null;
    };
  }, [select]);

  // Update data on agents/flows change.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.setData(buildData(agents, flows));
    g.render();
  }, [agents, flows]);

  // Switch layout.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.setLayout(LAYOUTS[layout]);
    g.render();
  }, [layout]);

  return (
    <div className="graph-wrap">
      <div className="graph-canvas" ref={containerRef} />
      <div className="layout-switch">
        <span className="section-label">视角</span>
        {(Object.keys(LAYOUTS) as LayoutKey[]).map((k) => (
          <button key={k} className={`chip ${layout === k ? "on" : ""}`} onClick={() => setLayout(k)}>{k}</button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 删除旧 GraphView**

Run: `git rm src/components/GraphView.tsx`

- [ ] **Step 3: 类型检查**

Run: `bunx tsc -b`
Expected: 无错误。若 G6 类型导出名有出入(如 `GraphData`),改 import 为 `import { Graph, NodeEvent } from "@antv/g6"` 并把 `GraphData` 改为本地 `type GraphData = Parameters<Graph["setData"]>[0]`。

- [ ] **Step 4: Commit**

```bash
git add src/components/FlowGraph.tsx
git commit -m "feat(coms-dashboard): G6 FlowGraph with layout presets, replaces GraphView"
```

---

## Task 8: NodePanel + InteractionComposer

**Files:**
- Create: `apps/coms-dashboard/src/components/InteractionComposer.tsx`
- Create: `apps/coms-dashboard/src/components/NodePanel.tsx`

- [ ] **Step 1: InteractionComposer**

`apps/coms-dashboard/src/components/InteractionComposer.tsx`:
```tsx
import { useMemo, useState } from "react";
import { useStore } from "../store";

export function InteractionComposer({ fromName }: { fromName: string }) {
  const agents = useStore((s) => s.agents);
  const orchestrate = useStore((s) => s.orchestrate);
  const peers = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit && a.name !== fromName).map((a) => a.name),
    [agents, fromName],
  );
  const [to, setTo] = useState("");
  const [task, setTask] = useState("");

  const effectiveTo = to || peers[0] || "";
  async function go() {
    if (!effectiveTo || !task.trim()) return;
    await orchestrate(fromName, effectiveTo, task.trim());
    setTask("");
  }

  return (
    <div className="composer">
      <div className="section-label">让 {fromName} 去联系</div>
      <select value={effectiveTo} onChange={(e) => setTo(e.target.value)}>
        {peers.length === 0 && <option value="">(无其他 agent)</option>}
        {peers.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <textarea
        value={task}
        placeholder={`让 ${fromName} 转达/协作的任务…`}
        onChange={(e) => setTask(e.target.value)}
      />
      <button className="send-btn" disabled={!effectiveTo || !task.trim()} onClick={go}>
        发起对话
      </button>
    </div>
  );
}
```

- [ ] **Step 2: NodePanel**

`apps/coms-dashboard/src/components/NodePanel.tsx`:
```tsx
import { useState } from "react";
import { useStore, DASHBOARD_ID } from "../store";
import { InteractionComposer } from "./InteractionComposer";

export function NodePanel() {
  const selected = useStore((s) => s.selected);
  const agents = useStore((s) => s.agents);
  const select = useStore((s) => s.select);
  const send = useStore((s) => s.send);
  const [msg, setMsg] = useState("");

  if (!selected || selected === DASHBOARD_ID) return null;
  const a = agents[selected];
  if (!a) return null;

  async function sendDirect() {
    if (!msg.trim()) return;
    await send(a.name, msg.trim());
    setMsg("");
  }

  return (
    <div className="node-panel">
      <div className="node-panel-head">
        <span className="dot" style={{ background: a.color }} />
        <b>{a.name}</b>
        <span className={`badge b-${a.status}`}>{a.status}</span>
        <button className="np-close" onClick={() => select(undefined)}>✕</button>
      </div>

      <dl className="np-details">
        <div><dt>model</dt><dd className="mono">{a.model}</dd></div>
        {a.provider && <div><dt>provider</dt><dd className="mono">{a.provider}</dd></div>}
        <div><dt>purpose</dt><dd>{a.purpose || "—"}</dd></div>
        <div><dt>cwd</dt><dd className="mono">{a.cwd}</dd></div>
        <div><dt>project</dt><dd className="mono">{a.project}</dd></div>
        <div><dt>ctx</dt><dd className="mono">{a.context_used_pct}%</dd></div>
        <div><dt>queue</dt><dd className="mono">q{a.queue_depth}</dd></div>
      </dl>

      <button className="np-jump" onClick={() => select(a.session_id)}>↪ 跳转到它的日志</button>

      <div className="composer">
        <div className="section-label">直接发消息 → {a.name}</div>
        <textarea value={msg} placeholder={`Message ${a.name}…`} onChange={(e) => setMsg(e.target.value)} />
        <button className="send-btn" disabled={!msg.trim()} onClick={sendDirect}>Send</button>
      </div>

      <InteractionComposer fromName={a.name} />
    </div>
  );
}
```

> 说明:「跳转到它的日志」复用 `select(a.session_id)`——LogRail(Task 9)监听 `selected` 自动展开并滚动。

- [ ] **Step 3: 类型检查**

Run: `bunx tsc -b`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/InteractionComposer.tsx src/components/NodePanel.tsx
git commit -m "feat(coms-dashboard): NodePanel (details/send/orchestrate) + InteractionComposer"
```

---

## Task 9: LogRail 组件(可折叠 + 聚焦滚动)

**Files:**
- Create: `apps/coms-dashboard/src/components/LogRail.tsx`

- [ ] **Step 1: 实现组件**

`apps/coms-dashboard/src/components/LogRail.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { TerminalCard } from "./TerminalCard";

export function LogRail() {
  const agents = useStore((s) => s.agents);
  const lines = useStore((s) => s.lines);
  const linesByAgent = useStore((s) => s.linesByAgent);
  const selected = useStore((s) => s.selected);

  const list = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Selecting a node opens + scrolls to its section.
  useEffect(() => {
    if (!selected) return;
    setExpanded((e) => ({ ...e, [selected]: true }));
    const el = sectionRefs.current[selected];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  function toggle(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  return (
    <div className="log-rail">
      {list.map((a) => {
        const open = expanded[a.session_id] ?? false;
        return (
          <div
            key={a.session_id}
            className={`log-acc ${open ? "" : "collapsed"} ${selected === a.session_id ? "sel" : ""}`}
            ref={(el) => { sectionRefs.current[a.session_id] = el; }}
          >
            <button className="log-acc-head" onClick={() => toggle(a.session_id)}>
              <span className="dot" style={{ background: a.color }} />
              <b>{a.name}</b>
              <span className="term-sub">{a.model}</span>
              <span className="log-chev">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="log-acc-body">
                <TerminalCard title={a.name} color={a.color} subtitle={a.model} lines={linesByAgent[a.session_id] ?? []} />
              </div>
            )}
          </div>
        );
      })}
      <div className="log-acc">
        <div className="log-acc-head static"><b>activity feed</b><span className="term-sub">all hub events</span></div>
        <div className="log-acc-body"><TerminalCard title="activity feed" subtitle="all hub events" lines={lines} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `bunx tsc -b`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/LogRail.tsx
git commit -m "feat(coms-dashboard): collapsible LogRail with focus-scroll"
```

---

## Task 10: App 三栏骨架 + 删除 Sidebar

**Files:**
- Modify: `apps/coms-dashboard/src/App.tsx`
- Delete: `apps/coms-dashboard/src/components/Sidebar.tsx`

- [ ] **Step 1: 重写 App.tsx**

`apps/coms-dashboard/src/App.tsx`:
```tsx
import { useEffect } from "react";
import { AddAgentForm } from "./components/AddAgentForm";
import { AgentList } from "./components/AgentList";
import { FlowGraph } from "./components/FlowGraph";
import { NodePanel } from "./components/NodePanel";
import { LogRail } from "./components/LogRail";
import { useStore } from "./store";

export default function App() {
  const init = useStore((s) => s.init);
  const shutdown = useStore((s) => s.shutdown);
  const status = useStore((s) => s.status);

  useEffect(() => {
    init();
    return () => shutdown();
  }, [init, shutdown]);

  return (
    <div className="app">
      <aside className="rail-left">
        <div className="brand">
          <div className="brand-logo">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-title">coms-net panel</div>
            <div className="brand-status"><span className={`status-led led-${status}`} /><span className="brand-sub">{status}</span></div>
          </div>
        </div>
        <AddAgentForm />
        <AgentList />
      </aside>

      <main className="rail-center">
        <FlowGraph />
        <NodePanel />
      </main>

      <aside className="rail-right">
        <LogRail />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: 删除 Sidebar**

Run: `git rm src/components/Sidebar.tsx`

- [ ] **Step 3: 类型检查 + 构建**

Run: `bunx tsc -b && bun run build`
Expected: 构建成功,无类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(coms-dashboard): three-column App shell, remove Sidebar"
```

---

## Task 11: 新区域样式

**Files:**
- Modify: `apps/coms-dashboard/src/styles.css`

- [ ] **Step 1: 把 `.app` grid 改成三列,并追加新样式**

把 `styles.css` 里现有的 `.app { ... grid-template-columns: 300px 1fr; ... }` 改为:
```css
.app { display: grid; grid-template-columns: 280px 1fr 320px; height: 100vh; }
```

在文件末尾(滚动条规则之前)追加:
```css
/* ── Left rail ───────────────────────────────────────── */
.rail-left { background: var(--panel); backdrop-filter: blur(16px); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 14px; gap: 12px; overflow: hidden; }
.rail-center { position: relative; min-width: 0; background: var(--bg); }
.rail-right { background: var(--streams-bg); border-left: 1px solid var(--border); overflow-y: auto; padding: 10px; }

/* ── Add agent ───────────────────────────────────────── */
.add-agent-toggle { width: 100%; background: var(--primary); color: var(--primary-fg); border: 0; border-radius: 12px; padding: 9px; font-size: 13px; font-weight: 500; cursor: pointer; box-shadow: var(--shadow-cta); }
.add-agent-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
.field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--muted); }
.field input, .field select, .composer textarea, .composer select { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; font-size: 12px; color: var(--text); font-family: inherit; }
.field input:focus, .field select:focus { outline: none; border-color: var(--primary); }
.field-row { display: flex; gap: 6px; }
.field-row input { flex: 1; min-width: 0; }
.field-check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.field-err { color: var(--red-text); font-size: 10px; }
.cmd-preview { background: var(--muted-surface); border-radius: 8px; padding: 7px 9px; }
.cmd-preview code { background: transparent; padding: 0; font-size: 11px; color: var(--text); word-break: break-all; white-space: pre-wrap; }
.add-agent-hint { font-size: 10px; color: var(--muted); }

/* ── Flow graph ──────────────────────────────────────── */
.graph-wrap { position: absolute; inset: 0; }
.graph-canvas { position: absolute; inset: 0; }
.layout-switch { position: absolute; top: 10px; right: 12px; display: flex; align-items: center; gap: 4px; background: var(--card); border: 1px solid var(--hairline); border-radius: 10px; padding: 4px 6px; backdrop-filter: blur(4px); }
.chip { font-size: 10px; padding: 3px 8px; border-radius: 9999px; border: 1px solid transparent; background: transparent; color: var(--muted); cursor: pointer; }
.chip.on { background: hsl(217 91% 60% / .1); color: var(--primary-strong); border-color: hsl(217 91% 60% / .25); }

/* ── Node panel ──────────────────────────────────────── */
.node-panel { position: absolute; top: 12px; left: 12px; width: 290px; max-height: calc(100% - 24px); overflow-y: auto; background: var(--card); border: 1px solid var(--hairline); border-radius: 12px; padding: 12px; backdrop-filter: blur(8px); box-shadow: var(--shadow-hover); display: flex; flex-direction: column; gap: 10px; }
.node-panel-head { display: flex; align-items: center; gap: 7px; }
.np-close { margin-left: auto; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 13px; }
.np-details { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.np-details > div { display: flex; gap: 8px; font-size: 11px; }
.np-details dt { color: var(--muted); width: 56px; flex: 0 0 auto; margin: 0; }
.np-details dd { margin: 0; color: var(--text); word-break: break-all; }
.np-jump { border: 1px solid var(--hairline); background: var(--bg); border-radius: 8px; padding: 6px; font-size: 11px; color: var(--primary-strong); cursor: pointer; }
.composer { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--hairline-soft); padding-top: 8px; }
.composer textarea { resize: none; height: 52px; }

/* ── Log rail accordion ──────────────────────────────── */
.log-acc { border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); margin-bottom: 8px; overflow: hidden; }
.log-acc.sel { border-color: var(--primary); }
.log-acc-head { display: flex; align-items: center; gap: 7px; width: 100%; border: 0; background: var(--muted-surface); padding: 8px 10px; cursor: pointer; font-size: 12px; color: var(--text); }
.log-acc-head.static { cursor: default; }
.log-chev { margin-left: auto; color: var(--muted); }
.log-acc-body { height: 220px; }
.log-acc-body .term-card { border: 0; border-radius: 0; box-shadow: none; height: 100%; }
.log-acc.collapsed .log-acc-body { display: none; }
```

- [ ] **Step 2: 构建确认**

Run: `bun run build`
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style(coms-dashboard): three-column layout + new region styles"
```

---

## Task 12: 浏览器验证

**Files:** 无(验证)。

- [ ] **Step 1: 起 dev server**

Run（后台）: `bun run dev`（http://localhost:5273,已有 hub 在跑则自动连）。

- [ ] **Step 2: 用 Playwright/浏览器核对(沿用 computed-style/DOM 断言方式)**

逐项确认:
- 三栏布局存在:`document.querySelector('.rail-left/.rail-center/.rail-right')` 均非空。
- G6 画布渲染:`.graph-canvas canvas` 存在;节点数 = agent 数 + 1。
- 点节点 → `.node-panel` 出现且右栏对应 `.log-acc.sel` 展开(`collapsed` 类移除)并滚动到位。
- 视角切换:点 `.chip` 后布局变化(节点坐标改变)。
- AddAgentForm:展开后输入 name/选 model → `.cmd-preview code` 文本等于 `launchCommand` 预期;重名时 `.field-err` 出现、Copy 禁用。
- 空状态:无 agent 时左栏出现引导文案。

- [ ] **Step 3: 跑全部单测**

Run: `bun test`
Expected: launchCommand(9)+ orchestratePrompt(3)全过。

- [ ] **Step 4: 终验 commit(若验证中有微调)**

```bash
git add -A && git commit -m "test(coms-dashboard): verify redesign in browser + unit tests green"
```

---

## Self-Review

**Spec coverage:**
- §3 布局 → Task 10/11 ✓
- §4 组件拆分 → Task 5–10 ✓(移除 Sidebar/GraphView)
- §5 AddAgentForm 参数 → Task 2(launchCommand)+ Task 5 ✓
- §6 FlowGraph(G6 + 4 预设)→ Task 7 ✓
- §7 NodePanel(4 能力)→ Task 8 ✓
- §8 LogRail(折叠 + 聚焦滚动)→ Task 9 ✓
- §9 orchestrate → Task 3 + Task 4 ✓
- §11 测试 → Task 2/3 单测 + Task 12 浏览器 ✓
- §12 依赖 → Task 1 ✓

**Placeholder scan:** 无 TBD/TODO;每个改码步骤都给了完整代码或精确改动位置。

**Type consistency:** `launchCommand(AgentLaunchSpec)` 在 Task 2 定义、Task 5 使用一致;`orchestrate(fromName,toName,task)` Task 4 定义、Task 8 经 InteractionComposer 使用一致;`select(undefined)` 清空选中(`select?: (id?) => void` 既有签名);`DASHBOARD_ID`、`FLOW_COLOR` 取值与现 store/设计系统一致。

**已知风险(执行时留意):** G6 v5 具体类型/布局名(`d3-force`/`antv-dagre`/`radial`)若与所装版本有出入,以 `bunx tsc -b` 报错为准就地校正(Task 7 Step 3 已给降级方案)。
