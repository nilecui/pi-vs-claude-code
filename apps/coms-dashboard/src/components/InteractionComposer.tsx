import { useMemo, useState } from "react";
import { useStore } from "../store";

export function InteractionComposer({ fromName }: { fromName: string }) {
  const agents = useStore((s) => s.agents);
  const orchestrate = useStore((s) => s.orchestrate);
  const peers = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit && a.name !== fromName).map((a) => a.name),
    [agents, fromName],
  );
  const [to, setTo] = useState("");
  const [task, setTask] = useState("");

  const effectiveTo = to || peers[0] || "";
  async function go() {
    if (!effectiveTo || !task.trim()) return;
    await orchestrate(fromName, effectiveTo, task.trim());
    setTask("");
  }

  return (
    <div className="composer">
      <div className="section-label">让 {fromName} 去联系</div>
      <select value={effectiveTo} onChange={(e) => setTo(e.target.value)}>
        {peers.length === 0 && <option value="">(无其他智能体)</option>}
        {peers.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <textarea
        value={task}
        placeholder={`让 ${fromName} 转达/协作的任务…`}
        onChange={(e) => setTask(e.target.value)}
      />
      <button className="send-btn" disabled={!effectiveTo || !task.trim()} onClick={go}>
        发起对话
      </button>
    </div>
  );
}
