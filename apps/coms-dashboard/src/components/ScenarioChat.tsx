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
  const [result, setResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const agentNames = useMemo(() => new Set(Object.values(agents).map((a) => a.name)), [agents]);
  const allOnline = sc.agents.every((a) => agentNames.has(a.name));

  // Only the panel's dispatches + each role's reply to the panel. Excludes any
  // stray peer (agent→agent) messages the firehose mirrors, so the thread stays
  // a clean dispatch→answer→dispatch→answer log.
  const thread = useMemo(() => {
    const roleSet = new Set(sc.agents.map((a) => a.name));
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
    const s = REAL_SCENARIOS.find((x) => x.id === id)!;
    setDraft(s.defaultInput);
    setStatus("");
    setResult(null);
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
  // Send one message to `target` and resolve with THAT message's reply, matched
  // by msg_id. Correlating on msg_id (not "the next response from this agent")
  // makes orchestration robust to multiple open dashboards, replays, and stale
  // history — only the reply to this exact prompt resolves the await.
  async function ask(target: string, prompt: string, timeoutMs = 240000): Promise<string> {
    // Responders must NOT re-delegate: the panel drives every hop, so each agent
    // has everything it needs to answer directly. Without this, agents with the
    // coms tool eagerly forward to each other and deadlock (mutual await).
    const full = `${prompt}\n\n【只回答,不要转发】请直接把结果回复给控制面板。禁止使用 coms / coms_net 等工具联系、转发或等待其它 agent —— 你已拥有完成本步骤所需的全部信息。`;
    const msgId = await send(target, full);
    if (!msgId) return "(发送失败:hub 未接受消息)";
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = useStore.getState().lines.find(
          (l) => l.msg_id === msgId && (l.kind === "response" || l.kind === "error"),
        );
        if (hit) { clearInterval(iv); resolve(hit.text); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve("(超时:未收到回复)"); }
      }, 600);
    });
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const missing = sc.agents.filter((a) => !agentNames.has(a.name));
      if (missing.length) {
        setStatus(`启动 ${missing.map((a) => a.name).join(" / ")}…`);
        try { await Promise.all(missing.map(spawnOne)); }
        catch { setStatus("spawner 未运行 — 先在终端跑 just spawner"); return; }
        setStatus("等待 agent 注册…(约 10–25s)");
        const ok = await waitFor(missing.map((a) => a.name));
        if (!ok) { setStatus("部分 agent 未注册,请重试"); return; }
      }
      await sc.orchestrate({ input: text, ask, setStatus, setResult });
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
        {result && <button className="result-open" onClick={() => setShowResult(true)}>📄 查看完整产出</button>}
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      <div className="chat-roles">{sc.blurb} · {allOnline ? "角色在线 ✓" : `角色:${sc.agents.map((a) => a.name).join(" / ")}`}</div>
      <div className="chat-body" ref={bodyRef}>
        {thread.length === 0 && <div className="chat-empty">选择场景,在下方填入任务并运行 → 面板按步骤把任务分派给每个角色,中间产出与 {sc.leadName} 的最终整合都会在这里逐条流式显示(Markdown 渲染)。</div>}
        {thread.map((l) => {
          if (l.from === "dashboard") {
            return <div key={l.id} className="chat-dispatch">↳ 分派给 <b>{l.to}</b></div>;
          }
          const isLead = l.from === sc.leadName;
          return (
            <div key={l.id} className={`chat-msg assistant ${isLead ? "lead" : "peer"}`}>
              <div className="chat-role">{l.from}{isLead ? " · 最终整合" : ""}</div>
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
          placeholder={sc.inputLabel}
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
