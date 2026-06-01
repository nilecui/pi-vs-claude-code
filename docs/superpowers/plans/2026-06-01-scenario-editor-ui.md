# 场景编辑器 UI(子项目 C)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在 dashboard 加表单式场景编辑器,用户纯靠表单增删角色/步骤(DAG)、写 prompt 与 assembly,实时校验,保存经 B 的 `/api/scenarios` 落库后即可运行。

**Architecture:** 纯草稿变换模块 `scenarioDraft.ts`(可单测)+ 模态表单 `ScenarioEditor.tsx`(复用 A 的纯 `validate` 实时校验)+ ScenarioChat 入口接线 + `client.duplicateScenario`。

**Tech Stack:** React 18 + TypeScript + Vite;`bun test`。复用 `src/lib/orchestration/{types,validate}`、`src/api/client`。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-scenario-editor-ui-design.md`
**Branch:** `coms-dashboard-terminals`
**工作目录:** `cd apps/coms-dashboard`;测试 `bun test src/lib/scenarioDraft.test.ts`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/scenarioDraft.ts` (new) | 纯草稿变换 |
| `src/lib/scenarioDraft.test.ts` (new) | 草稿变换单测 |
| `src/api/client.ts` (modify) | 补 `duplicateScenario` |
| `src/components/ScenarioEditor.tsx` (new) | 模态表单组件 |
| `src/components/ScenarioChat.tsx` (modify) | 新建/编辑/复制并编辑入口 + 保存后刷新 |
| `src/styles.css` (modify) | `.editor-*` 样式 |

---

### Task 1: 纯草稿变换 `scenarioDraft.ts`

**Files:**
- Create: `apps/coms-dashboard/src/lib/scenarioDraft.ts`
- Test: `apps/coms-dashboard/src/lib/scenarioDraft.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/scenarioDraft.test.ts
import { expect, test } from "bun:test";
import { blankScenario, addRole, updateRole, removeRole, addStep, updateStep, removeStep, toggleAfter, renameStepId } from "./scenarioDraft";

test("blankScenario 形状", () => {
  const s = blankScenario();
  expect(s).toEqual({ id: "", title: "", blurb: "", roles: [], input: { label: "", default: "" }, steps: [], assembly: "" });
});

test("addRole 自增不重名 + 默认值", () => {
  let s = addRole(blankScenario());
  expect(s.roles[0].name).toBe("role-1");
  expect(s.roles[0].provider).toBe("openai-codex");
  s = addRole(s);
  expect(s.roles[1].name).toBe("role-2");
});

test("updateRole / removeRole", () => {
  let s = addRole(addRole(blankScenario()));
  s = updateRole(s, 0, { name: "boss", purpose: "lead" });
  expect(s.roles[0].name).toBe("boss");
  expect(s.roles[0].purpose).toBe("lead");
  s = removeRole(s, 0);
  expect(s.roles.length).toBe(1);
  expect(s.roles[0].name).toBe("role-2");
});

test("addStep 用第一个角色名 + 自增 id", () => {
  let s = addRole(blankScenario());      // role-1
  s = addStep(s);
  expect(s.steps[0].id).toBe("step-1");
  expect(s.steps[0].role).toBe("role-1");
  s = addStep(s);
  expect(s.steps[1].id).toBe("step-2");
});

test("removeStep 联动从其它步骤 after 摘除被删 id", () => {
  let s = addRole(blankScenario());
  s = addStep(s); s = addStep(s);                 // step-1, step-2
  s = toggleAfter(s, 1, "step-1");                // step-2 依赖 step-1
  expect(s.steps[1].after).toEqual(["step-1"]);
  s = removeStep(s, 0);                           // 删 step-1
  expect(s.steps.length).toBe(1);
  expect(s.steps[0].after).toEqual([]);           // 引用被摘除
});

test("toggleAfter 增/删依赖", () => {
  let s = addRole(blankScenario()); s = addStep(s); s = addStep(s);
  s = toggleAfter(s, 1, "step-1");
  expect(s.steps[1].after).toEqual(["step-1"]);
  s = toggleAfter(s, 1, "step-1");
  expect(s.steps[1].after).toEqual([]);
});

test("renameStepId 联动更新别处 after 引用", () => {
  let s = addRole(blankScenario()); s = addStep(s); s = addStep(s);
  s = toggleAfter(s, 1, "step-1");                // step-2.after=[step-1]
  s = renameStepId(s, 0, "tech");                 // step-1 -> tech
  expect(s.steps[0].id).toBe("tech");
  expect(s.steps[1].after).toEqual(["tech"]);     // 引用同步改名
});

test("updateStep patch 合并", () => {
  let s = addRole(blankScenario()); s = addStep(s);
  s = updateStep(s, 0, { prompt: "hi {{input}}" });
  expect(s.steps[0].prompt).toBe("hi {{input}}");
  expect(s.steps[0].id).toBe("step-1"); // 其它字段保留
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/coms-dashboard && bun test src/lib/scenarioDraft.test.ts`
Expected: FAIL — `Cannot find module './scenarioDraft'`.

- [ ] **Step 3: 写实现**

```ts
// src/lib/scenarioDraft.ts
import type { ScenarioDef, RoleDef, StepDef } from "./orchestration/types";

export function blankScenario(): ScenarioDef {
  return { id: "", title: "", blurb: "", roles: [], input: { label: "", default: "" }, steps: [], assembly: "" };
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addRole(s: ScenarioDef): ScenarioDef {
  const taken = new Set(s.roles.map((r) => r.name));
  const name = uniqueName(`role-${s.roles.length + 1}`, taken);
  return { ...s, roles: [...s.roles, { name, provider: "openai-codex", model: "gpt-5.5", purpose: "", color: "#3b82f6" }] };
}
export function updateRole(s: ScenarioDef, i: number, patch: Partial<RoleDef>): ScenarioDef {
  return { ...s, roles: s.roles.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) };
}
export function removeRole(s: ScenarioDef, i: number): ScenarioDef {
  return { ...s, roles: s.roles.filter((_, idx) => idx !== i) };
}

export function addStep(s: ScenarioDef): ScenarioDef {
  const taken = new Set(s.steps.map((st) => st.id));
  const id = uniqueName(`step-${s.steps.length + 1}`, taken);
  return { ...s, steps: [...s.steps, { id, role: s.roles[0]?.name ?? "", prompt: "", after: [] }] };
}
export function updateStep(s: ScenarioDef, i: number, patch: Partial<StepDef>): ScenarioDef {
  return { ...s, steps: s.steps.map((st, idx) => (idx === i ? { ...st, ...patch } : st)) };
}
export function removeStep(s: ScenarioDef, i: number): ScenarioDef {
  const removedId = s.steps[i]?.id;
  return {
    ...s,
    steps: s.steps
      .filter((_, idx) => idx !== i)
      .map((st) => (removedId ? { ...st, after: st.after.filter((a) => a !== removedId) } : st)),
  };
}
export function toggleAfter(s: ScenarioDef, stepIdx: number, depId: string): ScenarioDef {
  return {
    ...s,
    steps: s.steps.map((st, idx) => {
      if (idx !== stepIdx) return st;
      const has = st.after.includes(depId);
      return { ...st, after: has ? st.after.filter((a) => a !== depId) : [...st.after, depId] };
    }),
  };
}
export function renameStepId(s: ScenarioDef, i: number, newId: string): ScenarioDef {
  const oldId = s.steps[i]?.id;
  return {
    ...s,
    steps: s.steps.map((st, idx) => {
      const id = idx === i ? newId : st.id;
      const after = oldId && oldId !== newId ? st.after.map((a) => (a === oldId ? newId : a)) : st.after;
      return { ...st, id, after };
    }),
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/coms-dashboard && bun test src/lib/scenarioDraft.test.ts`
Expected: PASS（8 tests）。

- [ ] **Step 5: Commit**

```bash
git add apps/coms-dashboard/src/lib/scenarioDraft.ts apps/coms-dashboard/src/lib/scenarioDraft.test.ts
git commit -m "feat(web): pure scenario draft transforms (roles/steps/after/rename)"
```

---

### Task 2: client 补 `duplicateScenario`

**Files:**
- Modify: `apps/coms-dashboard/src/api/client.ts`

- [ ] **Step 1: 在 `api` 对象里 `createScenario` 之后加一行**

```ts
  duplicateScenario: (id: string) => j<{ ok: boolean; id: string }>(`/api/scenarios/${encodeURIComponent(id)}/duplicate`, { method: "POST" }),
```

- [ ] **Step 2: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 3: Commit**

```bash
git add apps/coms-dashboard/src/api/client.ts
git commit -m "feat(web): api.duplicateScenario"
```

---

### Task 3: 编辑器组件 `ScenarioEditor.tsx` + 样式

**Files:**
- Create: `apps/coms-dashboard/src/components/ScenarioEditor.tsx`
- Modify: `apps/coms-dashboard/src/styles.css`

- [ ] **Step 1: 写组件**

```tsx
// src/components/ScenarioEditor.tsx
import { useMemo, useState } from "react";
import { validate } from "../lib/orchestration/validate";
import type { ScenarioDef } from "../lib/orchestration/types";
import { api } from "../api/client";
import * as draft from "../lib/scenarioDraft";

export function ScenarioEditor({ initial, onClose, onSaved }: {
  initial: ScenarioDef | null; onClose: () => void; onSaved: (id: string) => void;
}) {
  const isNew = initial === null;
  const [s, setS] = useState<ScenarioDef>(initial ? structuredClone(initial) : draft.blankScenario());
  const [saving, setSaving] = useState(false);
  const [serverErr, setServerErr] = useState<string[]>([]);
  const errors = useMemo(() => validate(s), [s]);
  const canSave = errors.length === 0 && (!isNew || s.id.trim() !== "") && !saving;

  async function save() {
    setSaving(true); setServerErr([]);
    try {
      if (isNew) await api.createScenario(s); else await api.updateScenario(s.id, s);
      onSaved(s.id);
    } catch (e) {
      const m = String(e); const jm = m.match(/\{[\s\S]*\}/);
      try { const d = jm ? JSON.parse(jm[0]) : null; setServerErr(d?.details ?? [m]); } catch { setServerErr([m]); }
      setSaving(false);
    }
  }
  async function del() {
    if (isNew) return;
    setSaving(true);
    try { await api.deleteScenario(s.id); onSaved(""); }
    catch (e) { setServerErr([String(e)]); setSaving(false); }
  }

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <strong>{isNew ? "新建场景" : `编辑:${s.title || s.id}`}</strong>
          <button className="result-copy" disabled={!canSave} onClick={save}>{saving ? "保存中…" : "保存"}</button>
          {!isNew && <button className="editor-del" onClick={del}>删除</button>}
          <button className="result-close" onClick={onClose}>✕</button>
        </div>
        {(errors.length > 0 || serverErr.length > 0) && (
          <div className="editor-errors">{[...errors, ...serverErr].map((e, i) => <div key={i}>⚠ {e}</div>)}</div>
        )}
        <div className="editor-body">
          <label className="editor-field"><span>ID</span><input value={s.id} disabled={!isNew} onChange={(e) => setS({ ...s, id: e.target.value })} /></label>
          <label className="editor-field"><span>标题</span><input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></label>
          <label className="editor-field"><span>简介</span><input value={s.blurb} onChange={(e) => setS({ ...s, blurb: e.target.value })} /></label>
          <label className="editor-field"><span>输入提示</span><input value={s.input.label} onChange={(e) => setS({ ...s, input: { ...s.input, label: e.target.value } })} /></label>
          <label className="editor-field"><span>默认输入</span><textarea value={s.input.default} onChange={(e) => setS({ ...s, input: { ...s.input, default: e.target.value } })} /></label>

          <div className="editor-section"><span>角色</span><button onClick={() => setS(draft.addRole(s))}>+ 角色</button></div>
          {s.roles.map((r, i) => (
            <div key={i} className="editor-role">
              <input placeholder="name" value={r.name} onChange={(e) => setS(draft.updateRole(s, i, { name: e.target.value }))} />
              <input placeholder="provider" value={r.provider} onChange={(e) => setS(draft.updateRole(s, i, { provider: e.target.value }))} />
              <input placeholder="model" value={r.model} onChange={(e) => setS(draft.updateRole(s, i, { model: e.target.value }))} />
              <input placeholder="purpose" value={r.purpose} onChange={(e) => setS(draft.updateRole(s, i, { purpose: e.target.value }))} />
              <input type="color" value={r.color} onChange={(e) => setS(draft.updateRole(s, i, { color: e.target.value }))} />
              <button onClick={() => setS(draft.removeRole(s, i))}>✗</button>
            </div>
          ))}

          <div className="editor-section"><span>步骤(DAG)</span><button onClick={() => setS(draft.addStep(s))}>+ 步骤</button></div>
          {s.steps.map((st, i) => (
            <div key={i} className="editor-step">
              <div className="editor-step-row">
                <input className="editor-stepid" placeholder="step id" value={st.id} onChange={(e) => setS(draft.renameStepId(s, i, e.target.value))} />
                <select value={st.role} onChange={(e) => setS(draft.updateStep(s, i, { role: e.target.value }))}>
                  <option value="">(选角色)</option>
                  {s.roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>
                <button onClick={() => setS(draft.removeStep(s, i))}>✗</button>
              </div>
              <textarea placeholder="prompt(支持 {{input}} 与 {{steps.<id>}})" value={st.prompt} onChange={(e) => setS(draft.updateStep(s, i, { prompt: e.target.value }))} />
              <div className="editor-deps">
                <span className="editor-muted">依赖:</span>
                {s.steps.filter((o) => o.id !== st.id).map((o) => (
                  <label key={o.id} className={`editor-chip ${st.after.includes(o.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={st.after.includes(o.id)} onChange={() => setS(draft.toggleAfter(s, i, o.id))} />{o.id}
                  </label>
                ))}
                {s.steps.length <= 1 && <span className="editor-muted">(无其它步骤)</span>}
              </div>
            </div>
          ))}

          <div className="editor-section"><span>装配模板(可选)</span></div>
          <textarea className="editor-assembly" placeholder="留空=汇点步骤产出拼接;支持 {{steps.<id>}}" value={s.assembly ?? ""} onChange={(e) => setS({ ...s, assembly: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 加 `.editor-*` 样式(追加到 `src/styles.css` 末尾)**

```css
.editor-backdrop { position: fixed; inset: 0; background: rgba(2,6,23,.45); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 70; }
.editor-modal { width: 760px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--hairline); border-radius: 14px; box-shadow: var(--shadow-hover); overflow: hidden; }
.editor-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--hairline); }
.editor-head strong { margin-right: auto; }
.editor-del { border: 1px solid hsl(0 84% 60% / .4); background: hsl(0 84% 60% / .06); color: #b91c1c; border-radius: 8px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
.editor-errors { padding: 8px 14px; background: hsl(0 84% 60% / .06); border-bottom: 1px solid hsl(0 84% 60% / .2); color: #b91c1c; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
.editor-body { overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.editor-field { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.editor-field input, .editor-field textarea { font: inherit; font-size: 13px; color: var(--text); padding: 6px 8px; border: 1px solid var(--hairline); border-radius: 8px; background: var(--card); }
.editor-field textarea { min-height: 48px; resize: vertical; }
.editor-section { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--text); border-top: 1px solid var(--hairline-soft); padding-top: 8px; }
.editor-section button { margin-left: auto; border: 1px solid var(--hairline); background: var(--muted-surface); border-radius: 8px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
.editor-role { display: flex; gap: 6px; align-items: center; }
.editor-role input:not([type=color]) { flex: 1; min-width: 0; font-size: 12px; padding: 5px 7px; border: 1px solid var(--hairline); border-radius: 7px; background: var(--card); }
.editor-role input[type=color] { width: 28px; height: 28px; padding: 0; border: 1px solid var(--hairline); border-radius: 6px; background: none; }
.editor-role button, .editor-step-row button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 14px; }
.editor-step { border: 1px solid var(--hairline-soft); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--muted-surface); }
.editor-step-row { display: flex; gap: 6px; align-items: center; }
.editor-stepid { width: 120px; font-size: 12px; padding: 5px 7px; border: 1px solid var(--hairline); border-radius: 7px; background: var(--card); }
.editor-step-row select { flex: 1; font-size: 12px; padding: 5px 7px; border: 1px solid var(--hairline); border-radius: 7px; background: var(--card); }
.editor-step textarea { font: inherit; font-size: 12px; min-height: 56px; resize: vertical; padding: 6px 8px; border: 1px solid var(--hairline); border-radius: 8px; background: var(--card); color: var(--text); }
.editor-deps { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; }
.editor-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid var(--hairline); border-radius: 999px; cursor: pointer; color: var(--muted); }
.editor-chip.on { border-color: var(--primary); color: var(--primary-strong); background: hsl(217 91% 60% / .06); }
.editor-chip input { margin: 0; }
.editor-muted { color: var(--muted); }
.editor-assembly { font: inherit; font-size: 12px; min-height: 64px; resize: vertical; padding: 6px 8px; border: 1px solid var(--hairline); border-radius: 8px; background: var(--card); color: var(--text); }
```

- [ ] **Step 3: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioEditor.tsx apps/coms-dashboard/src/styles.css
git commit -m "feat(web): scenario editor modal (form-based, live validate)"
```

---

### Task 4: ScenarioChat 接线(新建/编辑/复制并编辑 + 刷新)

**Files:**
- Modify: `apps/coms-dashboard/src/components/ScenarioChat.tsx`

- [ ] **Step 1: 加 import(文件顶部,types 旁)**

```tsx
import { ScenarioEditor } from "./ScenarioEditor";
```

- [ ] **Step 2: 在组件内加编辑器 state + 处理函数(放在 `esRef`/`bodyRef` 声明之后)**

```tsx
  const [editorInitial, setEditorInitial] = useState<ScenarioDef | null | undefined>(undefined); // undefined=关闭
  const current = scenarios.find((x) => x.id === sid);

  async function openEdit() {
    if (!current) return;
    if (current.builtin) {
      const { id } = await api.duplicateScenario(sid);
      const copy = await api.getScenario(id);
      setEditorInitial(copy);
    } else {
      setEditorInitial(await api.getScenario(sid));
    }
  }
  async function onEditorSaved(id: string) {
    const list = await api.listScenarios();
    setScenarios(list);
    setSid(id || list[0]?.id || "");
    setEditorInitial(undefined);
  }
```

- [ ] **Step 3: 头部加按钮(在 `chat-head` 的 `<select>` 之后、`result-open` 之前插入)**

```tsx
        <button className="result-open" onClick={() => setEditorInitial(null)}>+ 新建</button>
        {current && <button className="result-open" onClick={openEdit}>{current.builtin ? "复制并编辑" : "编辑"}</button>}
```

- [ ] **Step 4: 在 `</aside>` 之前(与 result 模态并列)渲染编辑器**

```tsx
      {editorInitial !== undefined && (
        <ScenarioEditor initial={editorInitial} onClose={() => setEditorInitial(undefined)} onSaved={onEditorSaved} />
      )}
```

- [ ] **Step 5: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 6: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioChat.tsx
git commit -m "feat(web): scenario editor entry (new/edit/duplicate) + refresh after save"
```

---

### Task 5: 全套验证 + 浏览器人工验收

**Files:** (无新增)

- [ ] **Step 1: 全套测试 + tsc + build**

Run: `cd apps/coms-dashboard && bun test && bunx tsc --noEmit && bun run build`
Expected: 全绿(含 scenarioDraft 8 个新测试);tsc 无输出;build 成功。

- [ ] **Step 2: 启动并人工验收**

```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server
just server
cd apps/coms-dashboard && bun run dev
```
在 http://localhost:5273 右侧场景区:
1. 点 **+ 新建** → 填 ID/标题 → 加 2 个角色(如 a、b)→ 加 2 个步骤(step-1 角色 a;step-2 角色 b,勾依赖 step-1,prompt 写 `处理:{{steps.step-1}}`)→ 顶部实时校验通过 → **保存** → 下拉出现新场景 → 选中可**运行**出真实产出。
2. 选内置「标书制作」→ **复制并编辑** → 改个标题 → 保存 → 出现为自定义副本、可运行。
3. 故意制造非法:把 step-2 的 id 改成和 step-1 相同 / 让 prompt 引用一个未勾依赖的步骤 / 连成环 → 顶部红条实时报错、**保存按钮禁用**。
4. 编辑自定义场景 → **删除** → 从下拉消失。

Expected: 全部符合;控制台 0 报错(favicon 忽略)。

- [ ] **Step 3: Commit(如有文档/收尾)**

```bash
git add -A && git commit -m "chore(C): scenario editor verified end-to-end" --allow-empty
```

---

## Self-Review(已执行)

- **Spec 覆盖:** C.1 入口/位置→Task 4;C.2 单元→Task 1/2/3;C.3 双层校验(复用 A 的 validate 实时 + 后端权威)→Task 3(`useMemo(validate)` + save 捕获 400 details);C.4 编辑器(isNew 判定 create/update、删除)→Task 3;C.5 接线(新建/编辑/复制并编辑 via duplicate、刷新)→Task 4;C.6 数据流→Task 3+4;C.7 错误处理→Task 3;C.8 测试(scenarioDraft 单测 + 人工)→Task 1+5。
- **占位符扫描:** 无 TBD/TODO;每个代码步骤含完整代码(组件、CSS、测试齐全)。
- **类型一致性:** `scenarioDraft.*` 签名(Task 1)与 ScenarioEditor 调用(Task 3)一致;`ScenarioDef/RoleDef/StepDef`(A)贯穿一致;`api.duplicateScenario/createScenario/updateScenario/deleteScenario/getScenario/listScenarios`(client)与 ScenarioEditor/ScenarioChat 调用一致;`ScenarioEditor` props `{initial,onClose,onSaved}`(Task 3 定义)与 Task 4 渲染一致;`editorInitial` 三态(`undefined`=关 / `null`=新建 / `ScenarioDef`=编辑)在 Task 4 内自洽。
- **已知取舍:** 编辑器组件本身无单测框架,靠 tsc + 浏览器验收;纯逻辑已抽到 `scenarioDraft` 并单测。
