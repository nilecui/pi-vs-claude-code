import { useState } from "react";
import { useStore, DASHBOARD_ID } from "../store";
import { InteractionComposer } from "./InteractionComposer";
import { AGENT_STATUS_LABEL } from "../lib/labels";

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
        <span className={`badge b-${a.status}`}>{AGENT_STATUS_LABEL[a.status] ?? a.status}</span>
        <button className="np-close" onClick={() => select(undefined)}>✕</button>
      </div>

      <dl className="np-details">
        <div><dt>模型</dt><dd className="mono">{a.model}</dd></div>
        {a.provider && <div><dt>提供方</dt><dd className="mono">{a.provider}</dd></div>}
        <div><dt>用途</dt><dd>{a.purpose || "—"}</dd></div>
        <div><dt>目录</dt><dd className="mono">{a.cwd}</dd></div>
        <div><dt>项目</dt><dd className="mono">{a.project}</dd></div>
        <div><dt>上下文</dt><dd className="mono">{a.context_used_pct}%</dd></div>
        <div><dt>队列</dt><dd className="mono">q{a.queue_depth}</dd></div>
      </dl>

      <button className="np-jump" onClick={() => select(a.session_id)}>↪ 跳转到它的日志</button>

      <div className="composer">
        <div className="section-label">直接发消息 → {a.name}</div>
        <textarea value={msg} placeholder={`发消息给 ${a.name}…`} onChange={(e) => setMsg(e.target.value)} />
        <button className="send-btn" disabled={!msg.trim()} onClick={sendDirect}>发送</button>
      </div>

      <InteractionComposer fromName={a.name} />
    </div>
  );
}
