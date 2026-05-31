import { useMemo } from "react";
import { useStore } from "../store";
import { AGENT_STATUS_LABEL } from "../lib/labels";

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
      <div className="section-label">智能体 · {list.length}</div>
      {list.length === 0 && (
        <div className="muted">暂无在线智能体。在上方新增,或运行 <code>just coms</code>。</div>
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
              {a.name} <span className={`badge b-${a.status}`}>{AGENT_STATUS_LABEL[a.status] ?? a.status}</span>
            </div>
            <div className="agent-row-model">{a.model}</div>
            <div className="ctx-bar sm"><div className="ctx-fill" style={{ width: `${Math.min(100, a.context_used_pct)}%` }} /></div>
          </div>
        </button>
      ))}
    </div>
  );
}
