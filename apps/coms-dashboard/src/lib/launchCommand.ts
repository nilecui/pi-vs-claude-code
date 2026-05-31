export interface AgentLaunchSpec {
  name: string;
  provider?: string;
  model?: string;
  purpose?: string;
  color?: string;
  project?: string;
  explicit?: boolean;
  cwd?: string;
  /** true → emit bare `pi -e …` (runs in any cwd); false → `just coms` (repo root). */
  bare?: boolean;
}

const BARE_BASE =
  "pi -e extensions/coms-net.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts";

/** Double-quote a value if it contains anything outside a safe shell-word set. */
function q(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function launchCommand(spec: AgentLaunchSpec): string {
  const args: string[] = ["--name", q(spec.name)];
  if (spec.provider) args.push("--provider", q(spec.provider));
  if (spec.model) args.push("--model", q(spec.model));
  if (spec.purpose) args.push("--purpose", q(spec.purpose));
  if (spec.color) args.push("--color", q(spec.color));
  if (spec.project && spec.project !== "default") args.push("--project", q(spec.project));
  if (spec.explicit) args.push("--explicit");

  const base = spec.bare ? BARE_BASE : "just coms";
  const cmd = `${base} ${args.join(" ")}`;
  return spec.cwd ? `cd ${q(spec.cwd)} && ${cmd}` : cmd;
}
