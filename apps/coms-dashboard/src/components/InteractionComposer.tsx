import { useMemo, useState } from "react";
import { useStore } from "../store";

export function InteractionComposer({ fromName }: { fromName: string }) {
  const agents = useStore((s) => s.agents);
  const orchestrate = useStore((s) => s.orchestrate);
  const peers = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit && a.name !== fromName),
    [agents, fromName],
  );
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [task, setTask] = useState("");

  // Drop selections for peers that left or for fromName itself.
  const validSel = useMemo(
    () => new Set([...sel].filter((n) => peers.some((p) => p.name === n))),
    [sel, peers],
  );

  function toggle(name: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }
  async function go() {
    const names = [...validSel];
    if (!names.length || !task.trim()) return;
    await Promise.all(names.map((to) => orchestrate(fromName, to, task.trim())));
    setTask("");
  }

  return (
    <div className="composer">
      <div className="section-label">让 {fromName} 去联系{validSel.size > 0 ? ` · ${validSel.size}` : ""}</div>
      {peers.length === 0 && <div className="muted">(无其他智能体)</div>}
      {peers.length > 0 && (
        <div className="bc-chips">
          {peers.map((p) => (
            <button
              key={p.session_id}
              className={`bc-chip ${validSel.has(p.name) ? "on" : ""}`}
              onClick={() => toggle(p.name)}
            >
              <span className="dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
          {peers.length > 1 && (
            <button
              className="bc-chip bc-all"
              onClick={() => setSel(validSel.size === peers.length ? new Set() : new Set(peers.map((p) => p.name)))}
            >
              {validSel.size === peers.length ? "清空" : "全选"}
            </button>
          )}
        </div>
      )}
      <textarea
        value={task}
        placeholder={`让 ${fromName} 转达/协作的任务…`}
        onChange={(e) => setTask(e.target.value)}
      />
      <button className="send-btn" disabled={validSel.size === 0 || !task.trim()} onClick={go}>
        发起对话{validSel.size > 0 ? ` (${validSel.size})` : ""}
      </button>
    </div>
  );
}
