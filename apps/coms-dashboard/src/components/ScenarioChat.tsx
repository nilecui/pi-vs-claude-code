import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import { REAL_SCENARIOS, type RealAgent } from "../lib/realScenarios";

// Typewriter-style reveal of a (markdown) message. coms-net delivers the full
// response in one frame, so we simulate streaming by revealing it progressively.
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
  const [sid, setSid] = useState(REAL_SCENARIOS[0].id);
  const sc = useMemo(() => REAL_SCENARIOS.find((x) => x.id === sid)!, [sid]);
  const [draft, setDraft] = useState(REAL_SCENARIOS[0].defaultInput);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const agentNames = useMemo(() => new Set(Object.values(agents).map((a) => a.name)), [agents]);
  const allOnline = sc.agents.every((a) => agentNames.has(a.name));

  const thread = useMemo(
    () => lines.filter((l) => (l.from === "dashboard" && l.to === sc.leadName) || (l.from === sc.leadName && l.to === "dashboard")),
    [lines, sc.leadName],
  );
  const scrollToBottom = () => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { scrollToBottom(); }, [thread.length]);

  function pick(id: string) {
    setSid(id);
    const s = REAL_SCENARIOS.find((x) => x.id === id)!;
    setDraft(s.defaultInput);
    setStatus("");
  }
  function spawnOne(a: RealAgent) {
    return fetch("/spawner/spawn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: a.name, provider: "openai-codex", model: "gpt-5.5", color: a.color, purpose: a.purpose }) });
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
  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (!sc.agents.every((a) => agentNames.has(a.name))) {
        setStatus("启动角色 agent…");
        try { await Promise.all(sc.agents.map(spawnOne)); }
        catch { setStatus("spawner 未运行 — 先在终端跑 just spawner"); return; }
        setStatus("等待 agent 注册…(约 10–25s)");
        const ok = await waitFor(sc.agents.map((a) => a.name));
        if (!ok) { setStatus("部分 agent 未注册,请重试"); return; }
        setStatus("下发任务…");
        await send(sc.leadName, sc.buildPrompt(text));
      } else {
        await send(sc.leadName, text);
      }
      setDraft("");
      setStatus("");
    } finally { setBusy(false); }
  }
  async function stop() {
    setStatus("停止本场景 agent…");
    try {
      const list = await (await fetch("/spawner/list")).json();
      const re = new RegExp("^pi-(" + sc.agents.map((a) => a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")-");
      const targets: string[] = (list.sessions || []).filter((s: string) => re.test(s));
      await Promise.all(targets.map((s) => fetch("/spawner/kill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: s }) })));
      setStatus(`已停止 ${targets.length} 个 agent`);
    } catch { setStatus("spawner 未运行"); }
  }

  return (
    <aside className="rail-chat">
      <div className="chat-head">
        <select value={sid} onChange={(e) => pick(e.target.value)}>
          {REAL_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      <div className="chat-roles">{sc.blurb} · {allOnline ? "角色在线 ✓" : `角色:${sc.agents.map((a) => a.name).join(" / ")}`}</div>
      <div className="chat-body" ref={bodyRef}>
        {thread.length === 0 && <div className="chat-empty">选择场景,在下方输入任务并发送 → {sc.leadName} 将协调团队产出(Markdown 渲染)。</div>}
        {thread.map((l) => (
          <div key={l.id} className={`chat-msg ${l.from === "dashboard" ? "user" : "assistant"}`}>
            <div className="chat-role">{l.from === "dashboard" ? "你" : l.from}</div>
            {l.from === sc.leadName
              ? <StreamingMarkdown text={l.text} onTick={scrollToBottom} />
              : <div className="chat-text">{l.text}</div>}
          </div>
        ))}
        {status && <div className="chat-status">{status}</div>}
      </div>
      <div className="chat-composer">
        <textarea
          value={draft}
          placeholder={allOnline ? `继续和 ${sc.leadName} 对话…` : sc.inputLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend(); }}
        />
        <button className="send-btn" disabled={busy || !draft.trim()} onClick={onSend}>
          {busy ? "处理中…" : allOnline ? "发送 ⌘↵" : "▶ 启动并下发"}
        </button>
      </div>
    </aside>
  );
}
