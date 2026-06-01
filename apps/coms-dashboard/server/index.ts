import { Database } from "bun:sqlite";
import type { RoleDef, ScenarioDef } from "../src/lib/orchestration/types";
import { validate } from "../src/lib/orchestration/validate";
import { SCENARIOS } from "../src/lib/orchestration/scenarios";
import * as dbm from "./db";
import { RunHub } from "./runHub";
import { startRun } from "./runner";
import { HubClient } from "./hubClient";
import { discoverHub } from "./hubConfig";
import { spawnAgent, killSession, listSessions, spawnMissing } from "./agents";
import { hashPassword, verifyPassword, createUser, getUserByName, createSession, getSessionUser, deleteSession, upsertOidcUser } from "./auth";
import { createTeam, listTeams, getTeam, addMember, removeMember, deleteTeam } from "./teams";
import { ssoEnabled, issueState, consumeState, buildAuthUrl, exchangeCode, fetchUserInfo } from "./oidc";

const PORT = Number(process.env.COMS_SERVER_PORT) || 5274;

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
}
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: cors() });
}

function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return decodeURIComponent(v.join("=")); }
  return null;
}
function sessionCookie(token: string, maxAgeSec = 7 * 24 * 3600): string {
  return `coms_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}
function jsonCookie(data: unknown, cookie: string, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(), "Set-Cookie": cookie } });
}

export interface ServerDeps {
  db: Database;
  hub: { ask: (role: string, prompt: string, timeoutMs: number) => Promise<string> };
  agents: { spawnMissing: (roles: RoleDef[]) => Promise<boolean> };
  awaitRuns?: boolean;
}

export function buildServer(deps: ServerDeps): (req: Request) => Promise<Response> {
  const runHub = new RunHub();

  function sseForRun(runId: string, userId: string): Response {
    const headers = { ...cors(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" };
    let unsub = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (e: { type: string; [k: string]: unknown }) =>
          controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        // 快照:先发已有 steps + 当前状态(迟到的订阅者也能看全)
        const run = dbm.getRun(deps.db, runId, userId);
        if (run) {
          for (const s of run.steps) send({ type: "step", stepId: s.step_id, role: s.role, status: s.status, output: s.output });
          if (run.result_md) send({ type: "result", md: run.result_md });
          if (run.status !== "running") send({ type: "done" });
        }
        unsub = runHub.subscribe(runId, (e) => send(e));
      },
      cancel() { unsub(); },
    });
    return new Response(stream, { headers });
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      // ---- auth(免鉴权)----
      if (req.method === "POST" && p === "/api/auth/register") {
        const { username, password } = (await req.json()) as { username: string; password: string };
        if (!username?.trim() || !password) return json({ error: "用户名/密码不能为空" }, 400);
        if (getUserByName(deps.db, username)) return json({ error: "用户名已被占用" }, 409);
        const newUid = createUser(deps.db, username, await hashPassword(password));
        const token = createSession(deps.db, newUid);
        return jsonCookie({ user: { id: newUid, username } }, sessionCookie(token));
      }
      if (req.method === "POST" && p === "/api/auth/login") {
        const { username, password } = (await req.json()) as { username: string; password: string };
        const u = getUserByName(deps.db, username ?? "");
        if (!u || !(await verifyPassword(password ?? "", u.password_hash))) return json({ error: "用户名或密码错误" }, 401);
        const token = createSession(deps.db, u.id);
        return jsonCookie({ user: { id: u.id, username: u.username } }, sessionCookie(token));
      }
      if (req.method === "POST" && p === "/api/auth/logout") {
        const tok = parseCookie(req, "coms_session");
        if (tok) deleteSession(deps.db, tok);
        return jsonCookie({ ok: true }, "coms_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      }
      if (req.method === "GET" && (p === "/api/health" || p === "/health")) return json({ ok: true, port: PORT });

      // ---- OIDC SSO(免鉴权;未配 env 则关闭)----
      if (req.method === "GET" && p === "/api/auth/config") return json({ sso: ssoEnabled() });
      if (req.method === "GET" && p === "/api/auth/oidc/login") {
        if (!ssoEnabled()) return json({ error: "SSO 未启用" }, 404);
        const state = issueState();
        return new Response(null, { status: 302, headers: { ...cors(), Location: await buildAuthUrl(state) } });
      }
      if (req.method === "GET" && p === "/api/auth/oidc/callback") {
        if (!ssoEnabled()) return json({ error: "SSO 未启用" }, 404);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        if (!consumeState(state)) return json({ error: "invalid state" }, 400);
        try {
          const { access_token } = await exchangeCode(code);
          const info = await fetchUserInfo(access_token);
          const u = upsertOidcUser(deps.db, info.sub, info.preferred_username || info.email || info.sub);
          const token = createSession(deps.db, u.id);
          return new Response(null, { status: 302, headers: { ...cors(), "Set-Cookie": sessionCookie(token), Location: "/" } });
        } catch {
          return new Response(null, { status: 302, headers: { ...cors(), Location: "/?sso_error=1" } });
        }
      }

      // ---- 会话中间件:其余路由需有效 session ----
      const user = getSessionUser(deps.db, parseCookie(req, "coms_session"));
      if (p === "/api/auth/me") return user ? json({ user }) : json({ error: "unauthorized" }, 401);
      if (!user) return json({ error: "unauthorized" }, 401);
      const uid = user.id;
      const requireMember = (teamId: string) => getTeam(deps.db, teamId, uid) !== null;

      // ---- teams ----
      if (req.method === "GET" && p === "/api/teams") return json({ teams: listTeams(deps.db, uid) });
      if (req.method === "POST" && p === "/api/teams") {
        const { name } = (await req.json()) as { name: string };
        if (!name?.trim()) return json({ error: "团队名不能为空" }, 400);
        return json({ id: createTeam(deps.db, name.trim(), uid) });
      }
      const teamMemMatch = p.match(/^\/api\/teams\/([^/]+)\/members(?:\/([^/]+))?$/);
      if (teamMemMatch) {
        const teamId = decodeURIComponent(teamMemMatch[1]);
        if (req.method === "POST" && !teamMemMatch[2]) {
          const { username } = (await req.json()) as { username: string };
          const r = addMember(deps.db, teamId, uid, username ?? "");
          if (r === "ok") return json({ ok: true });
          return json({ error: r }, r === "not_owner" ? 403 : r === "no_user" || r === "no_team" ? 404 : 409);
        }
        if (req.method === "DELETE" && teamMemMatch[2]) {
          const r = removeMember(deps.db, teamId, uid, decodeURIComponent(teamMemMatch[2]));
          return r === "ok" ? json({ ok: true }) : json({ error: "forbidden" }, 403);
        }
      }
      const teamIdMatch = p.match(/^\/api\/teams\/([^/]+)$/);
      if (teamIdMatch) {
        const teamId = decodeURIComponent(teamIdMatch[1]);
        if (req.method === "GET") { const t = getTeam(deps.db, teamId, uid); return t ? json({ team: t }) : json({ error: "not found" }, 404); }
        if (req.method === "DELETE") { const r = deleteTeam(deps.db, teamId, uid); return r === "ok" ? json({ ok: true }) : json({ error: "forbidden" }, 403); }
      }

      // ---- scenarios ----
      if (req.method === "GET" && p === "/api/scenarios") return json({ scenarios: dbm.listScenarios(deps.db, uid) });
      if (req.method === "POST" && p === "/api/scenarios") {
        const body = (await req.json()) as ScenarioDef & { teamId?: string | null };
        const errs = validate(body);
        if (errs.length) return json({ error: "invalid", details: errs }, 400);
        const teamId = body.teamId ?? null;
        if (teamId && !requireMember(teamId)) return json({ error: "无权共享到该团队" }, 400);
        dbm.upsertScenario(deps.db, body, false, uid, teamId);
        return json({ ok: true, id: body.id });
      }
      const dupMatch = p.match(/^\/api\/scenarios\/([^/]+)\/duplicate$/);
      if (req.method === "POST" && dupMatch) {
        const id = decodeURIComponent(dupMatch[1]);
        const src = dbm.getScenario(deps.db, id, uid);
        if (!src) return json({ error: "not found" }, 404);
        const copy: ScenarioDef = { ...src, id: `${src.id}-copy-${Date.now().toString(36)}`, title: `${src.title}(副本)` };
        dbm.upsertScenario(deps.db, copy, false, uid);
        return json({ ok: true, id: copy.id });
      }
      if (p.startsWith("/api/scenarios/")) {
        const id = decodeURIComponent(p.slice("/api/scenarios/".length));
        if (req.method === "GET") {
          const s = dbm.getScenario(deps.db, id, uid);
          return s ? json({ scenario: s, teamId: dbm.getScenarioTeamId(deps.db, id) }) : json({ error: "not found" }, 404);
        }
        if (req.method === "PUT") {
          if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可改,请先 duplicate" }, 409);
          if (!dbm.isScenarioOwner(deps.db, id, uid)) return json({ error: "无权修改(非创建者)" }, 403);
          const body = (await req.json()) as ScenarioDef & { teamId?: string | null };
          const errs = validate(body);
          if (errs.length) return json({ error: "invalid", details: errs }, 400);
          const teamId = body.teamId ?? null;
          if (teamId && !requireMember(teamId)) return json({ error: "无权共享到该团队" }, 400);
          dbm.upsertScenario(deps.db, body, false, uid, teamId);
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可删,请先 duplicate" }, 409);
          if (!dbm.isScenarioOwner(deps.db, id, uid)) return json({ error: "无权删除(非创建者)" }, 403);
          dbm.deleteScenario(deps.db, id);
          return json({ ok: true });
        }
      }

      // ---- runs ----
      if (req.method === "POST" && p === "/api/runs") {
        const { scenarioId, input } = (await req.json()) as { scenarioId: string; input: string };
        const scenario = dbm.getScenario(deps.db, scenarioId, uid);
        if (!scenario) return json({ error: "scenario not found" }, 404);
        if (deps.awaitRuns) {
          const runId = await startRun({ db: deps.db, hub: deps.hub, agents: deps.agents, runHub, scenario, input, ownerId: uid });
          return json({ runId });
        }
        const runId = dbm.createRun(deps.db, scenarioId, input, uid);
        void startRun({ db: deps.db, hub: deps.hub, agents: deps.agents, runHub, scenario, input, runId, ownerId: uid });
        return json({ runId });
      }
      if (req.method === "GET" && p === "/api/runs") {
        const sid = url.searchParams.get("scenarioId") ?? undefined;
        return json({ runs: dbm.listRuns(deps.db, uid, sid) });
      }
      const eventsMatch = p.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (req.method === "GET" && eventsMatch) return sseForRun(decodeURIComponent(eventsMatch[1]), uid);
      if (req.method === "GET" && p.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(p.slice("/api/runs/".length));
        const run = dbm.getRun(deps.db, runId, uid);
        return run ? json({ run }) : json({ error: "not found" }, 404);
      }

      // ---- agents ----
      if (req.method === "POST" && p === "/api/agents/spawn") {
        const b = (await req.json()) as { name: string; provider?: string; model?: string; purpose?: string; color?: string };
        return json(spawnAgent(b));
      }
      if (req.method === "POST" && p === "/api/agents/kill") {
        const b = (await req.json()) as { session: string };
        return json(killSession(b.session));
      }
      if (req.method === "GET" && p === "/api/agents") return json({ ok: true, sessions: listSessions() });

      // ---- spawner 向后兼容(经 Vite /spawner 代理 → 这里;AddAgentForm 等仍用 /spawn|/list|/kill)----
      if (req.method === "POST" && p === "/spawn") {
        const b = (await req.json()) as { name: string; provider?: string; model?: string; purpose?: string; color?: string };
        return json({ ...spawnAgent(b), name: b.name });
      }
      if (req.method === "GET" && p === "/list") return json({ ok: true, sessions: listSessions() });
      if (req.method === "POST" && p === "/kill") {
        const b = (await req.json()) as { session: string };
        return json(killSession(b.session));
      }
      if (req.method === "GET" && p === "/health") return json({ ok: true, port: PORT });

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  };
}

// 生产启动:发现 hub、建真实依赖、reset 残留 running、起 Bun.serve。
if (import.meta.main) {
  const dataDir = `${import.meta.dir}/data`;
  Bun.spawnSync(["mkdir", "-p", dataDir]);
  const db = new Database(`${dataDir}/coms.db`);
  dbm.migrate(db);
  dbm.seedScenarios(db, SCENARIOS);
  dbm.abortStaleRuns(db);
  const { baseUrl, token } = discoverHub();
  const hub = new HubClient({ baseUrl, token });
  const onlineNames = async () => {
    const res = await fetch(`${baseUrl}/v1/agents?project=default`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (!res) return new Set<string>();
    const j = await res.json().catch(() => ({ agents: [] }));
    return new Set<string>((j.agents ?? []).map((a: { name: string }) => a.name));
  };
  const agents = { spawnMissing: (roles: RoleDef[]) => spawnMissing(roles, onlineNames) };
  const handler = buildServer({ db, hub, agents, awaitRuns: false });
  // idleTimeout 拉满(255s,Bun 上限):run SSE 在 agent 思考期间会长时间无数据,
  // 否则默认 10s 会被关闭;前端 EventSource 断线会重连并由 sseForRun 重放快照兜底。
  const HOST = process.env.COMS_SERVER_HOST ?? "127.0.0.1";
  Bun.serve({ port: PORT, hostname: HOST, idleTimeout: 255, fetch: handler });
  console.log(`[coms-server] listening on http://${HOST}:${PORT} (hub ${baseUrl})`);
}
