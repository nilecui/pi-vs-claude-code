import { useMemo, useState } from "react";
import { useStore } from "../store";
import { launchCommand, type AgentLaunchSpec } from "../lib/launchCommand";

const PRESETS: Record<string, { provider?: string; model?: string }> = {
  "gpt-5.5": { provider: "openai", model: "gpt-5.5" },
  "claude-opus-4-7": { model: "claude-opus-4-7" },
  "deepseek/deepseek-v4-pro": { model: "deepseek/deepseek-v4-pro" },
  "z-ai/glm-5.1": { model: "z-ai/glm-5.1" },
  "MiniMax-M2.7": { provider: "minimax", model: "MiniMax-M2.7" },
  "Codex 订阅 · gpt-5.5": { provider: "openai-codex", model: "gpt-5.5" },
  custom: {},
};

export function AddAgentForm() {
  const agents = useStore((s) => s.agents);
  const names = useMemo(
    () => new Set(Object.values(agents).map((a) => a.name)),
    [agents],
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("gpt-5.5");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [color, setColor] = useState("");
  const [bare, setBare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [launchMsg, setLaunchMsg] = useState("");

  const dup = name.trim().length > 0 && names.has(name.trim());
  const sel = PRESETS[preset];
  const spec: AgentLaunchSpec = {
    name: name.trim() || "agent",
    provider: preset === "custom" ? provider.trim() || undefined : sel.provider,
    model: preset === "custom" ? model.trim() || undefined : sel.model,
    purpose: purpose.trim() || undefined,
    color: color.trim() || undefined,
    bare,
  };
  const command = launchCommand(spec);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      window.prompt("复制启动命令:", command);
    }
  }

  async function launch() {
    setLaunchMsg("启动中…");
    try {
      const r = await fetch("/spawner/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider: spec.provider,
          model: spec.model,
          purpose: spec.purpose,
          color: spec.color,
        }),
      });
      const j = await r.json();
      setLaunchMsg(j.ok ? "已启动 ✓ 稍候出现在池中" : "启动失败:" + (j.error || r.status));
    } catch {
      setLaunchMsg("spawner 未运行 — 先跑 just spawner,或用上面的命令手动启动");
    }
  }

  return (
    <div className="add-agent">
      <button className="add-agent-toggle" onClick={() => setOpen((o) => !o)}>
        + 新增智能体
      </button>
      {open && (
        <div className="add-agent-body">
          <label className="field">
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="alice" />
          </label>
          {dup && <div className="field-err">该名称已存在</div>}

          <label className="field">
            <span>模型</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.keys(PRESETS).map((k) => (
                <option key={k} value={k}>{k === "custom" ? "自定义" : k}</option>
              ))}
            </select>
          </label>
          {preset === "custom" && (
            <div className="field-row">
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="提供方" />
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型" />
            </div>
          )}

          <label className="field">
            <span>用途</span>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="生产守门人…" />
          </label>
          <label className="field">
            <span>颜色</span>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#10b981" />
          </label>
          <label className="field-check">
            <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
            <span>裸 pi -e 形式(任意目录可运行)</span>
          </label>

          <div className="cmd-preview">
            <code>{command}</code>
          </div>
          <div className="add-agent-actions">
            <button className="send-btn" disabled={!name.trim() || dup} onClick={copy}>
              {copied ? "已复制 ✓" : "复制命令"}
            </button>
            <button className="send-btn" disabled={!name.trim() || dup} onClick={launch}>▶ 启动</button>
          </div>
          {launchMsg && <div className="add-agent-hint">{launchMsg}</div>}
          <div className="add-agent-hint">在仓库根目录的终端里粘贴运行,agent 注册后会出现在池中。</div>
        </div>
      )}
    </div>
  );
}
