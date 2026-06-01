import path from "node:path";
import type { RoleDef } from "../src/lib/orchestration/types";

const REPO = path.resolve(import.meta.dir, "..", "..", ".."); // apps/coms-dashboard/server -> repo root

function q(v: unknown): string { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
function sessionName(name: string): string { return `pi-${name.replace(/[^A-Za-z0-9_-]/g, "")}-${Date.now().toString(36)}`; }

export function spawnAgent(opts: { name: string; provider?: string; model?: string; purpose?: string; color?: string }): { ok: boolean; session?: string; error?: string } {
  if (!/^[A-Za-z0-9_-]+$/.test(opts.name)) return { ok: false, error: "invalid name" };
  const parts = ["pi", "-e", `${REPO}/extensions/coms-net.ts`, "-e", `${REPO}/extensions/minimal.ts`,
    "-e", `${REPO}/extensions/theme-cycler.ts`, "--name", q(opts.name)];
  if (opts.provider) parts.push("--provider", q(opts.provider));
  if (opts.model) parts.push("--model", q(opts.model));
  if (opts.purpose) parts.push("--purpose", q(opts.purpose));
  if (opts.color) parts.push("--color", q(opts.color));
  const envFile = `${REPO}/.env`;
  const inner = [`cd ${q(REPO)}`, `[ -f ${q(envFile)} ] && set -a && . ${q(envFile)} && set +a`, parts.join(" ")].join("; ");
  const session = sessionName(opts.name);
  const proc = Bun.spawnSync(["tmux", "new-session", "-d", "-s", session, "bash", "-lc", inner], { env: process.env as Record<string, string> });
  if (!proc.success) return { ok: false, error: new TextDecoder().decode(proc.stderr) };
  return { ok: true, session };
}

export function listSessions(): string[] {
  const proc = Bun.spawnSync(["tmux", "list-sessions", "-F", "#{session_name}"], { env: process.env as Record<string, string> });
  if (!proc.success) return [];
  const out = new TextDecoder().decode(proc.stdout).trim();
  return out ? out.split("\n").filter((s) => s.startsWith("pi-")) : [];
}

export function killSession(session: string): { ok: boolean; error?: string } {
  if (!session.startsWith("pi-")) return { ok: false, error: "session must start with pi-" };
  const proc = Bun.spawnSync(["tmux", "kill-session", "-t", session], { env: process.env as Record<string, string> });
  return proc.success ? { ok: true } : { ok: false, error: new TextDecoder().decode(proc.stderr) };
}

// 起缺失角色并轮询 hub 直到注册或超时。onlineNames 由调用方提供(查询 hub)。
export async function spawnMissing(roles: RoleDef[], onlineNames: () => Promise<Set<string>>, timeoutMs = 50000): Promise<boolean> {
  const online = await onlineNames();
  const missing = roles.filter((r) => !online.has(r.name));
  if (missing.length === 0) return true;
  for (const r of missing) spawnAgent(r);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await Bun.sleep(1000);
    const cur = await onlineNames();
    if (missing.every((r) => cur.has(r.name))) return true;
  }
  return false;
}
