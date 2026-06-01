import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type ScenarioSummary } from "../api/client";
import type { ScenarioDef } from "../lib/orchestration/types";
import { ScenarioEditor } from "./ScenarioEditor";
import { RunHistory } from "./RunHistory";

function StreamingMarkdown({ text, onTick }: { text: string; onTick?: () => void }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0; const total = text.length; const step = Math.max(2, Math.ceil(total / 90));
    const t = setInterval(() => { i = Math.min(total, i + step); setShown(text.slice(0, i)); onTick?.(); if (i >= total) clearInterval(t); }, 28);
    return () => clearInterval(t);
  }, [text]);
  return (<div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{shown || ""}</ReactMarkdown>{shown.length < text.length && <span className="chat-caret" />}</div>);
}

interface StepView { stepId: string; role: string; status: string; output?: string; }

export function ScenarioChat() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [sid, setSid] = useState<string>("");
  const [detail, setDetail] = useState<ScenarioDef | null>(null);
  const [draft, setDraft] = useState("");
  const [steps, setSteps] = useState<StepView[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editorInitial, setEditorInitial] = useState<ScenarioDef | null | undefined>(undefined); // undefined=关闭
  const [showHistory, setShowHistory] = useState(false);
  const current = scenarios.find((x) => x.id === sid);

  async function openEdit() {
    if (!current) return;
    if (current.builtin) {
      const { id } = await api.duplicateScenario(sid);
      setEditorInitial(await api.getScenario(id));
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

  useEffect(() => { api.listScenarios().then((s) => { setScenarios(s); if (s[0]) setSid(s[0].id); }).catch(() => setStatusMsg("无法连接后端 — 先 just server")); }, []);
  useEffect(() => { if (!sid) return; api.getScenario(sid).then((d) => { setDetail(d); setDraft(d.input.default); setSteps([]); setResult(null); setStatusMsg(""); }).catch(() => {}); }, [sid]);
  useEffect(() => () => esRef.current?.close(), []);
  const scrollToBottom = () => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { scrollToBottom(); }, [steps.length]);

  function applyStep(ev: { stepId: string; role: string; status: string; output?: string }) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.stepId === ev.stepId);
      if (i === -1) return [...prev, ev];
      const next = prev.slice(); next[i] = ev; return next;
    });
  }

  async function runWith(text: string) {
    if (!sid || busy || !text.trim()) return;
    setBusy(true); setSteps([]); setResult(null); setStatusMsg("提交运行…");
    try {
      const runId = await api.createRun(sid, text.trim());
      const es = api.runEvents(runId); esRef.current = es;
      es.addEventListener("step", (e) => applyStep(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("status", (e) => setStatusMsg(JSON.parse((e as MessageEvent).data).msg ?? ""));
      es.addEventListener("result", (e) => setResult(JSON.parse((e as MessageEvent).data).md ?? ""));
      es.addEventListener("done", () => { es.close(); esRef.current = null; setBusy(false); });
      es.addEventListener("error", () => { es.close(); esRef.current = null; setBusy(false); setStatusMsg("运行出错"); });
    } catch (e) { setStatusMsg("创建运行失败:" + String(e)); setBusy(false); }
  }
  function run() { runWith(draft); }
  function rerun(input: string) { setShowHistory(false); setDraft(input); runWith(input); }
  async function stop() {
    if (!detail) return;
    setStatusMsg("停止本场景 agent…");
    try {
      const { sessions } = await api.agents();
      const re = new RegExp("^pi-(" + detail.roles.map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")-");
      const targets = sessions.filter((s) => re.test(s));
      await Promise.all(targets.map((s) => api.kill(s)));
      setStatusMsg(`已停止 ${targets.length} 个 agent`);
    } catch { setStatusMsg("后端未运行"); }
  }

  const roleNames = detail ? detail.roles.map((r) => r.name).join(" / ") : "";
  return (
    <aside className="rail-chat">
      <div className="chat-head">
        <select value={sid} onChange={(e) => setSid(e.target.value)}>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <button className="result-open" onClick={() => setEditorInitial(null)}>+ 新建</button>
        <button className="result-open" disabled={!sid} onClick={() => setShowHistory(true)}>历史</button>
        {current && <button className="result-open" onClick={openEdit}>{current.builtin ? "复制并编辑" : "编辑"}</button>}
        {result && <button className="result-open" onClick={() => setShowResult(true)}>📄 查看完整产出</button>}
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      <div className="chat-roles">{detail?.blurb} · 角色:{roleNames}</div>
      <div className="chat-body" ref={bodyRef}>
        {steps.length === 0 && <div className="chat-empty">选择场景,填入任务并运行 → 后端按步骤分派给每个角色,各角色产出与最终装配会在这里逐条流式显示。</div>}
        {steps.map((s) => (
          s.status === "running" || s.status === "pending" ? (
            <div key={s.stepId}>
              <div className="chat-dispatch">↳ 分派给 <b>{s.role}</b></div>
              <div className="chat-msg assistant peer"><div className="chat-role">{s.role}</div><div className="chat-md chat-thinking"><span /><span /><span /></div></div>
            </div>
          ) : (
            <div key={s.stepId}>
              <div className="chat-dispatch">↳ 分派给 <b>{s.role}</b></div>
              <div className="chat-msg assistant peer"><div className="chat-role">{s.role}{s.status === "timeout" ? " · 超时" : s.status === "error" ? " · 出错" : ""}</div><StreamingMarkdown text={s.output ?? ""} onTick={scrollToBottom} /></div>
            </div>
          )
        ))}
        {statusMsg && <div className="chat-status">{statusMsg}</div>}
      </div>
      <div className="chat-composer">
        <textarea value={draft} placeholder={detail?.input.label ?? "任务…"} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
        <button className="send-btn" disabled={busy || !draft.trim()} onClick={run}>{busy ? "运行中…" : "运行编排 ⌘↵"}</button>
      </div>
      {showResult && result && (
        <div className="result-backdrop" onClick={() => setShowResult(false)}>
          <div className="result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="result-head"><strong>{detail?.title} · 完整产出</strong><span className="result-sub">后端按角色真实正文无损装配</span>
              <button className="result-copy" onClick={() => navigator.clipboard?.writeText(result)}>复制全文</button>
              <button className="result-close" onClick={() => setShowResult(false)}>✕</button></div>
            <div className="result-body"><div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div></div>
          </div>
        </div>
      )}
      {editorInitial !== undefined && (
        <ScenarioEditor initial={editorInitial} onClose={() => setEditorInitial(undefined)} onSaved={onEditorSaved} />
      )}
      {showHistory && sid && (
        <RunHistory scenarioId={sid} onRerun={rerun} onClose={() => setShowHistory(false)} />
      )}
    </aside>
  );
}
