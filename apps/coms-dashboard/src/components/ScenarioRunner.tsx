import { useMemo, useState } from "react";
import { useStore } from "../store";
import { REAL_SCENARIOS, type RealAgent } from "../lib/realScenarios";

export function ScenarioRunner() {
  const agents = useStore((s) => s.agents);
  const send = useStore((s) => s.send);
  const [sid, setSid] = useState(REAL_SCENARIOS[0].id);
  const sc = useMemo(() => REAL_SCENARIOS.find((x) => x.id === sid)!, [sid]);
  const [input, setInput] = useState(REAL_SCENARIOS[0].defaultInput);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(id: string) {
    setSid(id);
    const s = REAL_SCENARIOS.find((x) => x.id === id)!;
    setInput(s.defaultInput);
    setMsg("");
  }
  function spawnOne(a: RealAgent) {
    return fetch("/spawner/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: a.name, provider: "openai-codex", model: "gpt-5.5", color: a.color, purpose: a.purpose }),
    });
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
  async function run() {
    setBusy(true);
    try {
      setMsg(`启动 ${sc.agents.length} 个真实 agent…`);
      try { await Promise.all(sc.agents.map(spawnOne)); }
      catch { setMsg("spawner 未运行 — 先在终端跑 just spawner"); return; }
      setMsg("等待 agent 注册到池…(约 10–25s)");
      const ok = await waitFor(sc.agents.map((a) => a.name));
      if (!ok) { setMsg("部分 agent 未按时注册,请确认 spawner 后重试"); return; }
      setMsg(`下发任务 → ${sc.leadName} 正在协调…`);
      await send(sc.leadName, sc.buildPrompt(input.trim()));
      setMsg("已下发 ✓ 在图/终端观察真实协作");
    } finally { setBusy(false); }
  }
  async function stop() {
    setMsg("停止并清理本场景 agent…");
    try {
      const list = await (await fetch("/spawner/list")).json();
      const re = new RegExp("^pi-(" + sc.agents.map((a) => a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")-");
      const targets: string[] = (list.sessions || []).filter((s: string) => re.test(s));
      await Promise.all(targets.map((s) => fetch("/spawner/kill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: s }) })));
      setMsg(`已停止 ${targets.length} 个 agent`);
    } catch { setMsg("spawner 未运行,无法停止"); }
  }
  const upCount = sc.agents.filter((a) => Object.values(agents).some((x) => x.name === a.name)).length;

  return (
    <div className="hier-runner">
      <div className="section-label">真实业务场景</div>
      <select value={sid} onChange={(e) => pick(e.target.value)}>
        {REAL_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      <div className="add-agent-hint">{sc.blurb} · 角色:{sc.agents.map((a) => a.name).join(" / ")}</div>
      <textarea value={input} placeholder={sc.inputLabel} onChange={(e) => setInput(e.target.value)} />
      <div className="hier-actions">
        <button className="send-btn" disabled={busy || !input.trim()} onClick={run}>{busy ? "运行中…" : "▶ 一键运行"}</button>
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      {msg && <div className="add-agent-hint">{msg}</div>}
      {upCount > 0 && <div className="add-agent-hint">在线角色:{upCount}/{sc.agents.length}</div>}
    </div>
  );
}
