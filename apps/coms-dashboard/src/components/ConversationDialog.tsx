import { useStore } from "../store";

export function ConversationDialog({ pair, onClose }: { pair: [string, string]; onClose: () => void }) {
  const lines = useStore((s) => s.lines);
  const [a, b] = pair;
  const convo = lines.filter(
    (l) => (l.from === a && l.to === b) || (l.from === b && l.to === a),
  );
  return (
    <div className="convo-backdrop" onClick={onClose}>
      <div className="convo-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="convo-head">
          <b>对话:{a} ↔ {b}</b>
          <span className="convo-count">{convo.length} 条</span>
          <button className="convo-close" onClick={onClose}>✕</button>
        </div>
        <div className="convo-body">
          {convo.length === 0 && <div className="convo-empty">— 暂无对话 —</div>}
          {convo.map((l) => (
            <div key={l.id} className={`convo-line k-${l.kind}`}>
              <span className="convo-from">{l.from}→{l.to}</span>
              <span className="convo-text">{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
