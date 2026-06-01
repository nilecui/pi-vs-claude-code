import { useState } from "react";
import { useStore } from "../store";

const HIER = [
  { name: "boss", color: "#3b82f6", purpose: "层级根:统筹并向下分派任务" },
  { name: "lead-a", color: "#10b981", purpose: "组长 A" },
  { name: "lead-b", color: "#f59e0b", purpose: "组长 B" },
];
const DEFAULT_TASK = "请分别询问 lead-a 和 lead-b:你负责领域里最该优先解决的一个问题是什么?汇总两人的回答后给我一个结论。";

export function HierarchyRunner() {
  const agents = useStore((s) => s.agents);
  const send = useStore((s) => s.send);
  const [task, setTask] = useState(DEFAULT_TASK);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function spawnOne(a: (typeof HIER)[number]) {
    return fetch("/spawner/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: a.name, provider: "openai-codex", model: "gpt-5.5", color: a.color, purpose: a.purpose }),
    });
  }
  function waitFor(names: string[], timeoutMs = 40000) {
    return new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const cur = Object.values(useStore.getState().agents).map((x) => x.name);
        if (names.every((n) => cur.includes(n))) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(false); }
      }, 1000);
    });
  }

  async function run() {
    setBusy(true);
    try {
      setMsg("启动层级 agent(boss / lead-a / lead-b)…");
      try {
        await Promise.all(HIER.map(spawnOne));
      } catch {
        setMsg("spawner 未运行 — 先在终端跑 just spawner");
        return;
      }
      setMsg("等待 agent 注册到池…(约 10–20s)");
      const ok = await waitFor(HIER.map((h) => h.name));
      if (!ok) {
        setMsg("部分 agent 未按时注册,请确认 spawner 在运行后重试");
        return;
      }
      setMsg("下发任务 → boss 正在向下编排…");
      await send("boss", `你是层级根 boss。${task}\n用你的 coms 工具联系 lead-a 与 lead-b,保持最少往返,完成后把结论报告给我。`);
      setMsg("已下发 ✓ 在图/终端观察真实往返(需 hub 开启 firehose 才能看到 peer 间消息)");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setMsg("停止并清理层级 agent…");
    try {
      const list = await (await fetch("/spawner/list")).json();
      const targets: string[] = (list.sessions || []).filter((s: string) => /^pi-(boss|lead-a|lead-b)-/.test(s));
      await Promise.all(
        targets.map((s) =>
          fetch("/spawner/kill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: s }) }),
        ),
      );
      setMsg(`已停止 ${targets.length} 个层级 agent`);
    } catch {
      setMsg("spawner 未运行,无法停止");
    }
  }

  const upCount = HIER.filter((h) => Object.values(agents).some((a) => a.name === h.name)).length;

  return (
    <div className="hier-runner">
      <div className="section-label">真实层级编排 · boss→lead×2</div>
      <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="下发给 boss 的任务…" />
      <div className="hier-actions">
        <button className="send-btn" disabled={busy} onClick={run}>{busy ? "运行中…" : "▶ 一键运行"}</button>
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      {msg && <div className="add-agent-hint">{msg}</div>}
      {upCount > 0 && <div className="add-agent-hint">在线层级 agent:{upCount}/3</div>}
    </div>
  );
}
