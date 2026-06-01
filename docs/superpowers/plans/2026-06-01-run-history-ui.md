# 运行历史 / 产出库 UI(子项目 E)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给历史运行做界面 —— 列出当前场景的历史运行、重看装配产出与各步骤、用旧输入重跑。

**Architecture:** 左右分栏模态 `RunHistory.tsx`(纯读 `/api/runs`)+ ScenarioChat 接线(「历史」入口 + 把 `run()` 抽成 `runWith(text)` 供重跑复用)。后端零改动。

**Tech Stack:** React 18 + TS + Vite;复用 `src/api/client`(`listRuns`/`getRun`)、react-markdown + remark-gfm。

**Spec:** `docs/superpowers/specs/2026-06-01-run-history-ui-design.md`
**Branch:** `coms-dashboard-terminals`(A+B+C 已完成)
**工作目录:** `cd apps/coms-dashboard`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/components/RunHistory.tsx` (new) | 运行历史模态:左列表(listRuns)+ 右详情(getRun)+ 重跑 |
| `src/components/ScenarioChat.tsx` (modify) | 「历史」按钮 + `showHistory` + 抽 `runWith(text)` + `rerun` |
| `src/styles.css` (modify) | `.history-*` 样式 |

复用(不改):`src/api/client.ts`(`listRuns`/`getRun`/`RunSummary`)。后端无改动。

> 参考:`RunSummary`(client.ts)= `{ id, scenario_id, input, status, result_md, created_at, finished_at }`;`api.getRun(id)` 返回 `run`(含 `steps: {step_id, role, status, output}[]` 与 `result_md`)。

---

### Task 1: RunHistory 组件 + 样式

**Files:**
- Create: `apps/coms-dashboard/src/components/RunHistory.tsx`
- Modify: `apps/coms-dashboard/src/styles.css`

- [ ] **Step 1: 写组件**

```tsx
// src/components/RunHistory.tsx
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type RunSummary } from "../api/client";

interface RunDetail {
  id: string; scenario_id: string; input: string; status: string;
  result_md: string | null; created_at: number; finished_at: number | null;
  steps: { step_id: string; role: string; status: string; output: string | null }[];
}

const STATUS_LABEL: Record<string, string> = { done: "完成", error: "出错", aborted: "中止", running: "运行中" };

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RunHistory({ scenarioId, onRerun, onClose }: {
  scenarioId: string; onRerun: (input: string) => void; onClose: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [sel, setSel] = useState<RunDetail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listRuns(scenarioId).then(setRuns).catch(() => setErr("加载历史失败"));
  }, [scenarioId]);

  async function open(id: string) {
    setErr("");
    try { setSel((await api.getRun(id)) as RunDetail); }
    catch { setErr("加载运行详情失败"); }
  }

  return (
    <div className="history-backdrop" onClick={onClose}>
      <div className="history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-head">
          <strong>运行历史</strong>
          <span className="result-sub">{runs.length} 条 · 当前场景</span>
          <button className="result-close" onClick={onClose}>✕</button>
        </div>
        {err && <div className="editor-errors">⚠ {err}</div>}
        <div className="history-body">
          <div className="history-list">
            {runs.length === 0 && <div className="chat-empty">本场景暂无运行记录</div>}
            {runs.map((r) => (
              <div key={r.id} className={`history-item ${sel?.id === r.id ? "on" : ""}`} onClick={() => open(r.id)}>
                <div className="history-item-top">
                  <span className={`history-badge st-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  <span className="history-time">{fmtTime(r.created_at)}</span>
                </div>
                <div className="history-input">{r.input}</div>
              </div>
            ))}
          </div>
          <div className="history-detail">
            {!sel && <div className="chat-empty">选择左侧一条运行查看产出与步骤。</div>}
            {sel && (
              <>
                <div className="history-detail-head">
                  <span className={`history-badge st-${sel.status}`}>{STATUS_LABEL[sel.status] ?? sel.status}</span>
                  <button className="result-copy" onClick={() => onRerun(sel.input)}>重跑</button>
                  {sel.result_md && <button className="result-copy" onClick={() => navigator.clipboard?.writeText(sel.result_md ?? "")}>复制产出</button>}
                </div>
                <div className="history-steps">
                  {sel.steps.map((s) => (
                    <details key={s.step_id} className="history-step">
                      <summary><b>{s.step_id}</b> · {s.role} · {STATUS_LABEL[s.status] ?? s.status}</summary>
                      <pre className="history-output">{s.output ?? "(无输出)"}</pre>
                    </details>
                  ))}
                </div>
                {sel.result_md
                  ? <div className="chat-md history-result"><ReactMarkdown remarkPlugins={[remarkGfm]}>{sel.result_md}</ReactMarkdown></div>
                  : <div className="chat-empty">该运行无装配产出({STATUS_LABEL[sel.status] ?? sel.status})。</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 追加 `.history-*` 样式到 `src/styles.css` 末尾**

```css
/* run history (sub-project E) */
.history-backdrop { position: fixed; inset: 0; background: rgba(2,6,23,.45); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 70; }
.history-modal { width: 860px; max-width: 95vw; height: 80vh; display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--hairline); border-radius: 14px; box-shadow: var(--shadow-hover); overflow: hidden; }
.history-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--hairline); }
.history-head strong { margin-right: 4px; }
.history-head .result-close { margin-left: auto; }
.history-body { flex: 1; display: grid; grid-template-columns: 280px 1fr; min-height: 0; }
.history-list { border-right: 1px solid var(--hairline); overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.history-item { border: 1px solid var(--hairline-soft); border-radius: 9px; padding: 8px; cursor: pointer; background: var(--card); }
.history-item:hover { border-color: var(--hairline); }
.history-item.on { border-color: var(--primary); background: hsl(217 91% 60% / .06); }
.history-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.history-time { font-size: 11px; color: var(--muted); margin-left: auto; }
.history-input { font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.history-badge { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--muted); }
.history-badge.st-done { color: #047857; border-color: hsl(160 84% 39% / .4); background: hsl(160 84% 39% / .08); }
.history-badge.st-error { color: #b91c1c; border-color: hsl(0 84% 60% / .4); background: hsl(0 84% 60% / .08); }
.history-badge.st-running { color: var(--primary-strong); border-color: hsl(217 91% 60% / .4); background: hsl(217 91% 60% / .08); }
.history-detail { overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.history-detail-head { display: flex; align-items: center; gap: 8px; }
.history-detail-head .result-copy { margin-left: 0; }
.history-steps { display: flex; flex-direction: column; gap: 6px; }
.history-step { border: 1px solid var(--hairline-soft); border-radius: 8px; padding: 6px 8px; background: var(--muted-surface); font-size: 12px; }
.history-step summary { cursor: pointer; color: var(--muted); }
.history-output { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; color: var(--text); margin: 6px 0 0; }
.history-result { border-top: 1px solid var(--hairline-soft); padding-top: 10px; }
```

- [ ] **Step 3: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add apps/coms-dashboard/src/components/RunHistory.tsx apps/coms-dashboard/src/styles.css
git commit -m "feat(web): run history modal (list + detail + rerun)"
```

---

### Task 2: ScenarioChat 接线(历史按钮 + runWith + 重跑)

**Files:**
- Modify: `apps/coms-dashboard/src/components/ScenarioChat.tsx`

- [ ] **Step 1: 加 import(与其它组件 import 同处)**

```tsx
import { RunHistory } from "./RunHistory";
```

- [ ] **Step 2: 加 `showHistory` state(在 `editorInitial` state 附近)**

```tsx
  const [showHistory, setShowHistory] = useState(false);
```

- [ ] **Step 3: 把 `run()` 改成 `runWith(text)` + 薄封装 `run()` + `rerun()`**

将现有:
```tsx
  async function run() {
    if (!sid || busy || !draft.trim()) return;
    setBusy(true); setSteps([]); setResult(null); setStatusMsg("提交运行…");
    try {
      const runId = await api.createRun(sid, draft.trim());
```
替换为:
```tsx
  async function runWith(text: string) {
    if (!sid || busy || !text.trim()) return;
    setBusy(true); setSteps([]); setResult(null); setStatusMsg("提交运行…");
    try {
      const runId = await api.createRun(sid, text.trim());
```
(其余 `run` 函数体不变,直到它的结尾 `}`。)

然后在 `runWith` 之后新增:
```tsx
  function run() { runWith(draft); }
  function rerun(input: string) { setShowHistory(false); setDraft(input); runWith(input); }
```

> 注:`runWith` 内部原本引用 `draft.trim()` 的地方都已改用参数 `text`;函数体里不再出现 `draft`。

- [ ] **Step 4: 头部加「历史」按钮(在「+ 新建」按钮一组里)**

在 `chat-head` 内、`+ 新建` 按钮之后加:
```tsx
        <button className="result-open" disabled={!sid} onClick={() => setShowHistory(true)}>历史</button>
```

- [ ] **Step 5: 渲染历史模态(在编辑器渲染那块旁边,`</aside>` 之前)**

```tsx
      {showHistory && sid && (
        <RunHistory scenarioId={sid} onRerun={rerun} onClose={() => setShowHistory(false)} />
      )}
```

- [ ] **Step 6: 验证编译**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit`
Expected: 无输出（注意:`run` 仍被「运行编排」按钮的 `onClick={run}` 调用,签名未变)。

- [ ] **Step 7: Commit**

```bash
git add apps/coms-dashboard/src/components/ScenarioChat.tsx
git commit -m "feat(web): history entry + rerun (extract runWith) in ScenarioChat"
```

---

### Task 3: 全套验证 + 浏览器人工验收

- [ ] **Step 1: tsc + 全套测试 + build**

Run: `cd apps/coms-dashboard && bunx tsc --noEmit && bun test && bun run build`
Expected: tsc 无输出;`bun test` 仍 61 pass(E 无新单测);build 成功。

- [ ] **Step 2: 启动并人工验收**

```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server
just server
cd apps/coms-dashboard && bun run dev
```
在 http://localhost:5273:
1. 选「层级编排」运行 1~2 次(产生历史)。
2. 点头部 **历史** → 左栏出现运行列表(时间/状态药丸/输入摘要)。
3. 点一条 → 右栏显示各步骤(可展开看 output)+ 装配产出(Markdown)+ 「复制产出」。
4. 点 **重跑** → 历史关闭、主聊天区用该 input **重新真实运行**并 SSE 实时显示;跑完「历史」里多一条新记录。
5. 控制台 0 报错(favicon 忽略)。

- [ ] **Step 3: Commit(收尾,可空)**

```bash
git commit --allow-empty -m "chore(E): run history verified end-to-end"
```

---

## Self-Review(已执行)

- **Spec 覆盖:** E.1 入口(历史按钮)→Task 2;E.2 组件(列表/详情/重跑/状态药丸/时间/空态)→Task 1;E.3 接线(showHistory + runWith 抽取 + rerun)→Task 2;E.4 复用 client(listRuns/getRun)→Task 1;E.6 样式 `.history-*`→Task 1;E.7 错误(加载失败/空/重跑)→Task 1(err 态)+ Task 2(rerun);E.8 测试(tsc/build/浏览器)→Task 3。
- **占位符扫描:** 无 TBD/TODO;组件、CSS、接线均给出完整代码。
- **类型一致性:** `RunHistory` props `{scenarioId,onRerun,onClose}`(Task 1)与 Task 2 渲染一致;`RunSummary`(client)字段用于列表;`getRun` 返回断言为含 `steps`/`result_md` 的 `RunDetail`(Task 1 本地接口,字段与 B 的 `getRun` 返回一致:`step_id/role/status/output`、`result_md`);`runWith(text)` 抽取后 `run()`/`rerun(input)` 调用一致,`onClick={run}`(运行按钮)不变。
- **已知取舍:** RunHistory 为薄读取 UI 无单测(数据层 B 已覆盖);`getRun` 返回用本地 `RunDetail` 接口断言(client 的 `getRun` 目前 `Promise<unknown>`,用 `as RunDetail`)。
