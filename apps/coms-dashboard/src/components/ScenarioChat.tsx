// src/components/ScenarioChat.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import { SCENARIOS } from "../lib/orchestration/scenarios";
import { runScenario, TIMEOUT_TEXT } from "../lib/orchestration/runScenario";
import type { RoleDef } from "../lib/orchestration/types";

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
  const [sid, setSid] = useState(SCENARIOS[0].id);
  const sc = useMemo(() => SCENARIOS.find((x) => x.id === sid)!, [sid]);
  const [draft, setDraft] = useState(SCENARIOS[0].input.default);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const agentNames = useMemo(() => new Set(Object.values(agents).map((a) => a.name)), [agents]);
  const allOnline = sc.roles.every((r) => agentNames.has(r.name));

  const thread = useMemo(() => {
    const roleSet = new Set(sc.roles.map((r) => r.name));
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
    const s = SCENARIOS.find((x) => x.id === id)!;
    setDraft(s.input.default);
    setStatus("");
    setResult(null);
  }

  function spawnOne(r: RoleDef) {
    return fetch("/spawner/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: r.name, provider: r.provider, model: r.model, color: r.color, purpose: r.purpose }),
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
  async function spawnMissing(roles: RoleDef[]): Promise<boolean> {
    const online = new Set(Object.values(useStore.getState().agents).map((a) => a.name));
    const missing = roles.filter((r) => !online.has(r.name));
    if (missing.length === 0) return true;
    setStatus(`启动 ${missing.map((r) => r.name).join(" / ")}…`);
    try { await Promise.all(missing.map(spawnOne)); }
    catch { setStatus("spawner 未运行 — 先在终端跑 just spawner"); return false; }
    setStatus("等待 agent 注册…(约 10–25s)");
    return waitFor(missing.map((r) => r.name));
  }

  // 按 msg_id 关联:发出后只认这条 msg_id 的回复(对多面板/历史鲁棒)。超时 resolve TIMEOUT_TEXT。
  async function ask(role: string, prompt: string, timeoutMs: number): Promise<string> {
    const msgId = await send(role, prompt);
    if (!msgId) return "(发送失败:hub 未接受消息)";
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = useStore.getState().lines.find(
          (l) => l.msg_id === msgId && (l.kind === "response" || l.kind === "error"),
        );
        if (hit) { clearInterval(iv); resolve(hit.text); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(TIMEOUT_TEXT); }
      }, 600);
    });
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setResult(null);
    try {
      await runScenario(sc, text, {
        ask,
        spawnMissing,
        onStepUpdate: () => {},
        onStatus: setStatus,
        onResult: setResult,
      });
    } finally { setBusy(false); }
  }
  async function stop() {
    setStatus("停止本场景 agent…");
    try {
      const listResp = await (await fetch("/spawner/list")).json();
      const re = new RegExp("^pi-(" + sc.roles.map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")-");
      const targets: string[] = (listResp.sessions || []).filter((s: string) => re.test(s));
      await Promise.all(targets.map((s) => fetch("/spawner/kill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: s }) })));
      setStatus(`已停止 ${targets.length} 个 agent`);
    } catch { setStatus("spawner 未运行"); }
  }

  return (
    <aside className="rail-chat">
      <div className="chat-head">
        <select value={sid} onChange={(e) => pick(e.target.value)}>
          {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        {result && <button className="result-open" onClick={() => setShowResult(true)}>📄 查看完整产出</button>}
        <button className="hier-stop" onClick={stop}>停止</button>
      </div>
      <div className="chat-roles">{sc.blurb} · {allOnline ? "角色在线 ✓" : `角色:${sc.roles.map((r) => r.name).join(" / ")}`}</div>
      <div className="chat-body" ref={bodyRef}>
        {thread.length === 0 && <div className="chat-empty">选择场景,在下方填入任务并运行 → 面板按步骤把任务分派给每个角色,中间产出与最终整合都会在这里逐条流式显示(Markdown 渲染)。</div>}
        {thread.map((l) => {
          if (l.from === "dashboard") {
            return <div key={l.id} className="chat-dispatch">↳ 分派给 <b>{l.to}</b></div>;
          }
          return (
            <div key={l.id} className="chat-msg assistant peer">
              <div className="chat-role">{l.from}</div>
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
          placeholder={sc.input.label}
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
