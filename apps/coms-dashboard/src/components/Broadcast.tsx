import { useMemo, useState } from "react";
import { useStore } from "../store";

export function Broadcast() {
  const agents = useStore((s) => s.agents);
  const broadcast = useStore((s) => s.broadcast);
  const list = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [sentMsg, setSentMsg] = useState("");

  // Drop selections for agents that left.
  const validSel = useMemo(() => new Set([...sel].filter((n) => list.some((a) => a.name === n))), [sel, list]);

  function toggle(name: string) {
    setSel((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  function allOrNone() {
    setSel(validSel.size === list.length ? new Set() : new Set(list.map((a) => a.name)));
  }
  async function go() {
    const names = [...validSel];
    if (!names.length || !text.trim()) return;
    await broadcast(names, text.trim());
    setSentMsg(`已群发给 ${names.length} 个 agent ✓`);
    setText("");
    setTimeout(() => setSentMsg(""), 2000);
  }

  return (
    <div className="broadcast">
      <button className="bc-toggle" onClick={() => setOpen((o) => !o)}>
        <span>{open ? "▾" : "▸"}</span> 群发消息{validSel.size > 0 ? ` · ${validSel.size}` : ""}
      </button>
      {open && (
        <div className="bc-body">
          {list.length === 0 && <div className="muted">暂无在线 agent</div>}
          {list.length > 0 && (
            <div className="bc-chips">
              {list.map((a) => (
                <button
                  key={a.session_id}
                  className={`bc-chip ${validSel.has(a.name) ? "on" : ""}`}
                  onClick={() => toggle(a.name)}
                >
                  <span className="dot" style={{ background: a.color }} />
                  {a.name}
                </button>
              ))}
              {list.length > 1 && (
                <button className="bc-chip bc-all" onClick={allOrNone}>
                  {validSel.size === list.length ? "清空" : "全选"}
                </button>
              )}
            </div>
          )}
          <textarea
            value={text}
            placeholder="群发给选中的 agent…"
            onChange={(e) => setText(e.target.value)}
          />
          <button className="send-btn" disabled={validSel.size === 0 || !text.trim()} onClick={go}>
            群发 ({validSel.size})
          </button>
          {sentMsg && <div className="add-agent-hint">{sentMsg}</div>}
        </div>
      )}
    </div>
  );
}
