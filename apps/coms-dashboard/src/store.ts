import { create } from "zustand";
import { HubClient } from "./api/hub";
import type { AgentCard, SseEvent, StreamLine } from "./types";
import { orchestratePrompt } from "./lib/orchestratePrompt";
import { SCENARIOS } from "./lib/scenarios";

export const DASHBOARD_ID = "__dashboard__";
const MAX_LINES = 500;

export interface FlowPulse {
  id: string;
  from: string; // session_id or DASHBOARD_ID
  to: string;
  kind: "prompt" | "response" | "error";
  ts: number;
}

interface State {
  status: "connecting" | "online" | "offline";
  statusDetail?: string;
  serverId?: string;
  agents: Record<string, AgentCard>;
  lines: StreamLine[]; // global activity log
  linesByAgent: Record<string, StreamLine[]>;
  flows: FlowPulse[]; // transient edge pulses for the graph
  edgeCounts: Record<string, number>; // cumulative message count per connection (sorted-pair key)
  selected?: string;
  selectNonce: number;
  demoAgents: Record<string, AgentCard>;
  client: HubClient | null;

  init: () => void;
  shutdown: () => void;
  send: (target: string, prompt: string) => Promise<void>;
  orchestrate: (fromName: string, toName: string, task: string) => Promise<void>;
  select: (sessionId?: string) => void;
  clearFlow: (id: string) => void;
  runScenario: (id: string) => void;
  clearDemo: () => void;
}

let lineSeq = 0;
const nextId = () => `${Date.now()}-${lineSeq++}`;

function responseText(response: unknown, error: string | null | undefined): string {
  if (error != null) return `⚠ ${error}`;
  if (typeof response === "string") return response;
  return JSON.stringify(response, null, 2);
}

function sessionByName(agents: Record<string, AgentCard>, name: string): string | undefined {
  return Object.values(agents).find((a) => a.name === name)?.session_id;
}

// Symmetric key for a connection between two endpoints, so prompt and response
// over the same pair accumulate into one count. Exported for the graph's labels.
export const edgeKey = (a: string, b: string) => [a, b].sort().join("::");

// The hub sends sender/responder as { session_id, name }, but tolerate a bare
// string (name or session_id) for forward/backward compat.
function refName(ref: { name: string } | string): string {
  return typeof ref === "string" ? ref : ref.name;
}
function refSession(
  ref: { session_id?: string; name: string } | string,
  agents: Record<string, AgentCard>,
): string {
  if (typeof ref !== "string") return ref.session_id ?? sessionByName(agents, ref.name) ?? ref.name;
  return sessionByName(agents, ref) ?? ref;
}

let scenarioTimers: ReturnType<typeof setTimeout>[] = [];

export const useStore = create<State>((set, get) => {
  function pushLine(line: StreamLine, agentSession?: string) {
    set((s) => {
      const lines = [...s.lines, line].slice(-MAX_LINES);
      const linesByAgent = { ...s.linesByAgent };
      if (agentSession) {
        linesByAgent[agentSession] = [...(linesByAgent[agentSession] ?? []), line].slice(-MAX_LINES);
      }
      return { lines, linesByAgent };
    });
  }

  function pulse(from: string, to: string, kind: FlowPulse["kind"]) {
    const id = nextId();
    set((s) => ({
      flows: [...s.flows, { id, from, to, kind, ts: Date.now() }],
      edgeCounts: { ...s.edgeCounts, [edgeKey(from, to)]: (s.edgeCounts[edgeKey(from, to)] ?? 0) + 1 },
    }));
    setTimeout(() => get().clearFlow(id), 2400);
  }

  function handleEvent(e: SseEvent) {
    const agents = get().agents;
    switch (e.event) {
      case "hello":
        set({ serverId: e.data.server_id });
        break;

      case "pool_snapshot": {
        const map: Record<string, AgentCard> = {};
        for (const a of e.data.agents) map[a.session_id] = a;
        set((s) => ({ agents: { ...map, ...s.demoAgents } }));
        break;
      }

      case "agent_joined":
        set((s) => ({ agents: { ...s.agents, [e.data.agent.session_id]: e.data.agent } }));
        pushLine({ id: nextId(), ts: Date.now(), kind: "system", from: "hub", text: `▸ ${e.data.agent.name} joined (${e.data.agent.model})` });
        break;

      case "agent_updated":
        set((s) => ({ agents: { ...s.agents, [e.data.agent.session_id]: e.data.agent } }));
        break;

      case "agent_stale":
        set((s) => {
          const a = s.agents[e.data.session_id];
          return a ? { agents: { ...s.agents, [e.data.session_id]: { ...a, status: "stale" } } } : {};
        });
        break;

      case "agent_left":
        set((s) => {
          const next = { ...s.agents };
          delete next[e.data.session_id];
          return { agents: next };
        });
        pushLine({ id: nextId(), ts: Date.now(), kind: "system", from: "hub", text: `▾ ${e.data.name} left (${e.data.reason})` });
        break;

      case "prompt": {
        // A peer is messaging the dashboard directly.
        const fromName = refName(e.data.sender);
        const fromSession = refSession(e.data.sender, agents);
        pulse(fromSession, DASHBOARD_ID, "prompt");
        pushLine(
          { id: nextId(), ts: Date.now(), kind: "prompt", from: fromName, to: "dashboard", msg_id: e.data.msg_id, text: e.data.prompt },
          fromSession in agents ? fromSession : undefined,
        );
        break;
      }

      case "response": {
        const fromName = refName(e.data.responder);
        const fromSession = refSession(e.data.responder, agents);
        const isErr = e.data.error != null || e.data.status === "error";
        pulse(fromSession, DASHBOARD_ID, isErr ? "error" : "response");
        pushLine(
          { id: nextId(), ts: Date.now(), kind: isErr ? "error" : "response", from: fromName, msg_id: e.data.msg_id, text: responseText(e.data.response, e.data.error) },
          fromSession in agents ? fromSession : undefined,
        );
        break;
      }

      case "observe": {
        // Firehose copy of a peer↔peer message the dashboard isn't a party to.
        const fromName = e.data.sender.name;
        const toName = e.data.target.name;
        const fromSession = e.data.sender.session_id;
        const toSession = e.data.target.session_id;
        const isErr = e.data.phase === "response" && (e.data.error != null || e.data.status === "error");
        pulse(fromSession, toSession, isErr ? "error" : e.data.phase);
        const text =
          e.data.phase === "prompt"
            ? e.data.prompt ?? ""
            : responseText(e.data.response, e.data.error ?? null);
        const line: StreamLine = {
          id: nextId(), ts: Date.now(),
          kind: isErr ? "error" : e.data.phase,
          from: fromName, to: toName, msg_id: e.data.msg_id, text,
        };
        // Show on both participants' cards so the conversation reads on either side.
        pushLine(line, fromSession in agents ? fromSession : undefined);
        if (toSession in agents) {
          set((s) => ({
            linesByAgent: { ...s.linesByAgent, [toSession]: [...(s.linesByAgent[toSession] ?? []), line].slice(-MAX_LINES) },
          }));
        }
        break;
      }

      case "message_status":
        pushLine({ id: nextId(), ts: Date.now(), kind: "status", from: "hub", msg_id: e.data.msg_id, text: `${e.data.msg_id.slice(-6)} → ${e.data.status}` });
        break;
    }
  }

  return {
    status: "connecting",
    agents: {},
    demoAgents: {},
    lines: [],
    linesByAgent: {},
    flows: [],
    edgeCounts: {},
    selectNonce: 0,
    client: null,

    init() {
      if (get().client) return;
      const client = new HubClient({
        onEvent: handleEvent,
        onStatus: (status, detail) => set({ status, statusDetail: detail }),
      });
      set({ client });
      client.start();
      // Seed the pool immediately so the UI isn't empty before the first SSE snapshot.
      client.listAgents().then((list) => {
        set((s) => {
          const map = { ...s.agents };
          for (const a of list) map[a.session_id] = a;
          return { agents: map };
        });
      }).catch(() => {});
    },

    shutdown() {
      get().client?.stop();
      set({ client: null });
    },

    async send(target, prompt) {
      const client = get().client;
      if (!client) return;
      const targetSession = sessionByName(get().agents, target) ?? target;
      pulse(DASHBOARD_ID, targetSession, "prompt");
      pushLine(
        { id: nextId(), ts: Date.now(), kind: "prompt", from: "dashboard", to: target, text: prompt },
        targetSession in get().agents ? targetSession : undefined,
      );
      try {
        await client.send(target, prompt);
      } catch (err) {
        pushLine({ id: nextId(), ts: Date.now(), kind: "error", from: "hub", text: `send failed: ${err}` });
      }
    },

    async orchestrate(fromName, toName, task) {
      const client = get().client;
      if (!client) return;
      const agents = get().agents;
      const fromSession = sessionByName(agents, fromName) ?? fromName;
      const toSession = sessionByName(agents, toName) ?? toName;
      pulse(fromSession, toSession, "prompt");
      pushLine(
        { id: nextId(), ts: Date.now(), kind: "prompt", from: fromName, to: toName, text: `(orchestrate) ${task}` },
        fromSession in agents ? fromSession : undefined,
      );
      try {
        await client.send(fromName, orchestratePrompt(toName, task));
      } catch (err) {
        pushLine({ id: nextId(), ts: Date.now(), kind: "error", from: "hub", text: `orchestrate failed: ${err}` });
      }
    },

    select(sessionId) {
      set((s) => ({ selected: sessionId, selectNonce: s.selectNonce + 1 }));
    },

    clearFlow(id) {
      set((s) => ({ flows: s.flows.filter((f) => f.id !== id) }));
    },

    clearDemo() {
      scenarioTimers.forEach(clearTimeout); scenarioTimers = [];
      set((s) => {
        const demoIds = new Set(Object.keys(s.demoAgents));
        const agents = { ...s.agents };
        for (const id of demoIds) delete agents[id];
        const linesByAgent = { ...s.linesByAgent };
        for (const id of demoIds) delete linesByAgent[id];
        const edgeCounts: Record<string, number> = {};
        for (const [k, v] of Object.entries(s.edgeCounts)) {
          const [a, b] = k.split("::");
          if (!demoIds.has(a) && !demoIds.has(b)) edgeCounts[k] = v;
        }
        return { demoAgents: {}, agents, linesByAgent, edgeCounts,
                 flows: s.flows.filter((f) => !demoIds.has(f.from) && !demoIds.has(f.to)) };
      });
    },

    runScenario(id) {
      const sc = SCENARIOS.find((x) => x.id === id);
      if (!sc) return;
      get().clearDemo();
      const iso = new Date().toISOString();
      const demo: Record<string, AgentCard> = {};
      for (const a of sc.agents) {
        demo[a.session_id] = {
          session_id: a.session_id,
          name: a.name,
          model: a.model,
          provider: a.provider,
          color: a.color,
          purpose: a.purpose,
          explicit: false,
          status: "online",
          started_at: iso,
          context_used_pct: 12,
          queue_depth: 0,
          cwd: "/demo",
          project: "default",
        };
      }
      set((s) => ({ demoAgents: { ...s.demoAgents, ...demo }, agents: { ...s.agents, ...demo } }));

      for (const step of sc.steps) {
        const timer = setTimeout(() => {
          pulse(
            step.fromSession,
            step.toSession,
            step.kind === "response" ? "response" : step.kind === "error" ? "error" : "prompt",
          );
          const line: StreamLine = { id: nextId(), ts: Date.now(), kind: step.kind, from: step.from, to: step.to, text: step.text };
          set((s) => {
            const lines = [...s.lines, line].slice(-MAX_LINES);
            const linesByAgent = { ...s.linesByAgent };
            for (const sid of [step.fromSession, step.toSession]) {
              if (sid === DASHBOARD_ID) continue;
              linesByAgent[sid] = [...(linesByAgent[sid] ?? []), line].slice(-MAX_LINES);
            }
            return { lines, linesByAgent };
          });
        }, step.delay);
        scenarioTimers.push(timer);
      }
    },
  };
});
