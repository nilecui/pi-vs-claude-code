// Localhost-only dev tool — spawns pi coms-net agents in detached tmux (PTY) sessions.
// Executes processes; bind 127.0.0.1 only. Not for production.
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
const PORT = Number(process.env.PI_SPAWNER_PORT) || 5274;

/** Sanitize a name into a valid, unique tmux session name. */
function sessionName(name: string): string {
  return `pi-${name.replace(/[^A-Za-z0-9_-]/g, "")}-${Date.now().toString(36)}`;
}

/** Single-quote-escape a shell value so it is safe inside bash -lc '...' */
function q(v: unknown): string {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

async function handleSpawn(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const name = body.name;
  if (typeof name !== "string" || !name.trim()) {
    return json({ ok: false, error: "name must be a non-empty string" }, 400);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return json({ ok: false, error: "name must match /^[A-Za-z0-9_-]+$/" }, 400);
  }

  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "";
  const project = typeof body.project === "string" ? body.project.trim() : "";
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

  // Build pi argv with absolute extension paths so cwd is flexible.
  const piParts: string[] = [
    "pi",
    "-e", `${REPO}/extensions/coms-net.ts`,
    "-e", `${REPO}/extensions/minimal.ts`,
    "-e", `${REPO}/extensions/theme-cycler.ts`,
    "--name", q(name),
  ];
  if (provider) piParts.push("--provider", q(provider));
  if (model) piParts.push("--model", q(model));
  if (purpose) piParts.push("--purpose", q(purpose));
  if (color) piParts.push("--color", q(color));
  if (project && project !== "default") piParts.push("--project", q(project));

  const piArgv = piParts.join(" ");
  const workDir = cwd || REPO;
  const envFile = `${REPO}/.env`;

  // Source .env if present so provider keys (e.g. MINIMAX_API_KEY) are available.
  const innerCmd = [
    `cd ${q(workDir)}`,
    `[ -f ${q(envFile)} ] && set -a && . ${q(envFile)} && set +a`,
    piArgv,
  ].join("; ");

  const session = sessionName(name);
  const proc = Bun.spawnSync(
    ["tmux", "new-session", "-d", "-s", session, "bash", "-lc", innerCmd],
    { env: process.env as Record<string, string> },
  );

  if (!proc.success) {
    const stderr = new TextDecoder().decode(proc.stderr);
    return json({ ok: false, error: `tmux failed (exit ${proc.exitCode}): ${stderr}` }, 500);
  }

  console.log(`[agent-spawner] spawned session=${session} name=${name}`);
  return json({ ok: true, session, name });
}

function handleList(): Response {
  const proc = Bun.spawnSync(
    ["tmux", "list-sessions", "-F", "#{session_name}"],
    { env: process.env as Record<string, string> },
  );
  // tmux exits non-zero when no server/sessions exist — treat as empty list.
  if (!proc.success) {
    const stderr = new TextDecoder().decode(proc.stderr);
    if (/no server running|no sessions/i.test(stderr) || proc.exitCode === 1) {
      return json({ ok: true, sessions: [] });
    }
    return json({ ok: false, error: stderr }, 500);
  }
  const all = new TextDecoder().decode(proc.stdout).trim();
  const sessions = all ? all.split("\n").filter((s) => s.startsWith("pi-")) : [];
  return json({ ok: true, sessions });
}

async function handleKill(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const session = body.session;
  if (typeof session !== "string" || !session.startsWith("pi-")) {
    return json({ ok: false, error: "session must start with pi-" }, 400);
  }
  const proc = Bun.spawnSync(
    ["tmux", "kill-session", "-t", session],
    { env: process.env as Record<string, string> },
  );
  if (!proc.success) {
    const stderr = new TextDecoder().decode(proc.stderr);
    return json({ ok: false, error: `kill failed: ${stderr}` }, 500);
  }
  return json({ ok: true });
}

async function fetch(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method === "POST" && url.pathname === "/spawn") return handleSpawn(req);
  if (req.method === "GET" && url.pathname === "/list") return handleList();
  if (req.method === "POST" && url.pathname === "/kill") return handleKill(req);
  if (req.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, port: PORT });
  }

  return json({ ok: false }, 404);
}

Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch });
console.log("[agent-spawner] listening on http://127.0.0.1:" + PORT);
