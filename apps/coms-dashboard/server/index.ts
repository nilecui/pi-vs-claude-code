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

export interface ServerDeps {
  db: Database;
  hub: { ask: (role: string, prompt: string, timeoutMs: number) => Promise<string> };
  agents: { spawnMissing: (roles: RoleDef[]) => Promise<boolean> };
  awaitRuns?: boolean;
}

export function buildServer(deps: ServerDeps): (req: Request) => Promise<Response> {
  const runHub = new RunHub();

  function sseForRun(runId: string): Response {
    const headers = { ...cors(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" };
    let unsub = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (e: { type: string; [k: string]: unknown }) =>
          controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        // 快照:先发已有 steps + 当前状态(迟到的订阅者也能看全)
        const run = dbm.getRun(deps.db, runId);
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
      if (req.method === "GET" && p === "/api/health") return json({ ok: true, port: PORT });

      // ---- scenarios ----
      if (req.method === "GET" && p === "/api/scenarios") return json({ scenarios: dbm.listScenarios(deps.db) });
      if (req.method === "POST" && p === "/api/scenarios") {
        const body = (await req.json()) as ScenarioDef;
        const errs = validate(body);
        if (errs.length) return json({ error: "invalid", details: errs }, 400);
        dbm.upsertScenario(deps.db, body, false);
        return json({ ok: true, id: body.id });
      }
      const dupMatch = p.match(/^\/api\/scenarios\/([^/]+)\/duplicate$/);
      if (req.method === "POST" && dupMatch) {
        const id = decodeURIComponent(dupMatch[1]);
        const src = dbm.getScenario(deps.db, id);
        if (!src) return json({ error: "not found" }, 404);
        const copy: ScenarioDef = { ...src, id: `${src.id}-copy-${Date.now().toString(36)}`, title: `${src.title}(副本)` };
        dbm.upsertScenario(deps.db, copy, false);
        return json({ ok: true, id: copy.id });
      }
      if (p.startsWith("/api/scenarios/")) {
        const id = decodeURIComponent(p.slice("/api/scenarios/".length));
        if (req.method === "GET") {
          const s = dbm.getScenario(deps.db, id);
          return s ? json({ scenario: s }) : json({ error: "not found" }, 404);
        }
        if (req.method === "PUT") {
          if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可改,请先 duplicate" }, 409);
          const body = (await req.json()) as ScenarioDef;
          const errs = validate(body);
          if (errs.length) return json({ error: "invalid", details: errs }, 400);
          dbm.upsertScenario(deps.db, body, false);
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          if (dbm.isBuiltin(deps.db, id)) return json({ error: "内置场景不可删,请先 duplicate" }, 409);
          dbm.deleteScenario(deps.db, id);
          return json({ ok: true });
        }
      }

      // ---- runs ----
      if (req.method === "POST" && p === "/api/runs") {
        const { scenarioId, input } = (await req.json()) as { scenarioId: string; input: string };
        const scenario = dbm.getScenario(deps.db, scenarioId);
        if (!scenario) return json({ error: "scenario not found" }, 404);
        if (deps.awaitRuns) {
          const runId = await startRun({ db: deps.db, hub: deps.hub, agents: deps.agents, runHub, scenario, input });
          return json({ runId });
        }
        const runId = dbm.createRun(deps.db, scenarioId, input);
        void startRun({ db: deps.db, hub: deps.hub, agents: deps.agents, runHub, scenario, input, runId });
        return json({ runId });
      }
      if (req.method === "GET" && p === "/api/runs") {
        const sid = url.searchParams.get("scenarioId") ?? undefined;
        return json({ runs: dbm.listRuns(deps.db, sid) });
      }
      const eventsMatch = p.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (req.method === "GET" && eventsMatch) return sseForRun(decodeURIComponent(eventsMatch[1]));
      if (req.method === "GET" && p.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(p.slice("/api/runs/".length));
        const run = dbm.getRun(deps.db, runId);
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
  Bun.serve({ port: PORT, hostname: "127.0.0.1", idleTimeout: 255, fetch: handler });
  console.log("[coms-server] listening on http://127.0.0.1:" + PORT + " (hub " + baseUrl + ")");
}
