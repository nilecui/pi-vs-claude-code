import { useMemo, useState } from "react";
import { useStore } from "../store";

export function Sidebar() {
  const status = useStore((s) => s.status);
  const statusDetail = useStore((s) => s.statusDetail);
  const agents = useStore((s) => s.agents);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const send = useStore((s) => s.send);

  const [prompt, setPrompt] = useState("");
  const list = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const target = list.find((a) => a.session_id === selected);

  async function submit() {
    if (!target || !prompt.trim()) return;
    await send(target.name, prompt.trim());
    setPrompt("");
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className={`status-led led-${status}`} />
        <div>
          <div className="brand-title">coms-net panel</div>
          <div className="brand-sub">{status}{statusDetail ? ` · ${statusDetail.slice(0, 40)}` : ""}</div>
        </div>
      </div>

      <div className="section-label">agents · {list.length}</div>
      <div className="agent-list">
        {list.length === 0 && <div className="muted">No agents online. Start one with <code>just coms</code>.</div>}
        {list.map((a) => (
          <button
            key={a.session_id}
            className={`agent-row ${selected === a.session_id ? "sel" : ""}`}
            onClick={() => select(a.session_id)}
          >
            <span className="dot" style={{ background: a.color }} />
            <div className="agent-row-main">
              <div className="agent-row-name">{a.name} <span className={`badge b-${a.status}`}>{a.status}</span></div>
              <div className="agent-row-model">{a.model}</div>
              <div className="ctx-bar sm"><div className="ctx-fill" style={{ width: `${Math.min(100, a.context_used_pct)}%` }} /></div>
            </div>
          </button>
        ))}
      </div>

      <div className="compose">
        <div className="section-label">
          send {target ? <>→ <b>{target.name}</b></> : <span className="muted">(select an agent)</span>}
        </div>
        <textarea
          value={prompt}
          placeholder={target ? `Message ${target.name}…` : "Select an agent first"}
          disabled={!target}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <button className="send-btn" disabled={!target || !prompt.trim()} onClick={submit}>
          Send <span className="hint">⌘↵</span>
        </button>
      </div>
    </aside>
  );
}
