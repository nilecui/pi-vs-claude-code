import { useMemo, useState } from "react";
import { useStore } from "../store";
import { launchCommand, type AgentLaunchSpec } from "../lib/launchCommand";

const PRESETS: Record<string, { provider?: string; model?: string }> = {
  "gpt-5.5": { provider: "openai", model: "gpt-5.5" },
  "claude-opus-4-7": { model: "claude-opus-4-7" },
  "deepseek/deepseek-v4-pro": { model: "deepseek/deepseek-v4-pro" },
  "z-ai/glm-5.1": { model: "z-ai/glm-5.1" },
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
      window.prompt("Copy the launch command:", command);
    }
  }

  return (
    <div className="add-agent">
      <button className="add-agent-toggle" onClick={() => setOpen((o) => !o)}>
        + Add Agent
      </button>
      {open && (
        <div className="add-agent-body">
          <label className="field">
            <span>name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="alice" />
          </label>
          {dup && <div className="field-err">name already in pool</div>}

          <label className="field">
            <span>model</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.keys(PRESETS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          {preset === "custom" && (
            <div className="field-row">
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="provider" />
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" />
            </div>
          )}

          <label className="field">
            <span>purpose</span>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Prod gatekeeper…" />
          </label>
          <label className="field">
            <span>color</span>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#10b981" />
          </label>
          <label className="field-check">
            <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
            <span>裸 pi -e 形式(任意目录可运行)</span>
          </label>

          <div className="cmd-preview">
            <code>{command}</code>
          </div>
          <button className="send-btn" disabled={!name.trim() || dup} onClick={copy}>
            {copied ? "Copied ✓" : "Copy command"}
          </button>
          <div className="add-agent-hint">在仓库根目录的终端里粘贴运行,agent 注册后会出现在池中。</div>
        </div>
      )}
    </div>
  );
}
