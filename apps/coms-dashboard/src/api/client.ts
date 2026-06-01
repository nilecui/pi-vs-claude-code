import type { ScenarioDef } from "../lib/orchestration/types";

export interface ScenarioSummary { id: string; title: string; blurb: string; builtin: number; }
export interface RunSummary { id: string; scenario_id: string; input: string; status: string; result_md: string | null; created_at: number; finished_at: number | null; }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

export const api = {
  listScenarios: () => j<{ scenarios: ScenarioSummary[] }>("/api/scenarios").then((r) => r.scenarios),
  getScenario: (id: string) => j<{ scenario: ScenarioDef }>(`/api/scenarios/${encodeURIComponent(id)}`).then((r) => r.scenario),
  createScenario: (s: ScenarioDef) => j<{ ok: boolean; id: string }>("/api/scenarios", { method: "POST", body: JSON.stringify(s) }),
  updateScenario: (id: string, s: ScenarioDef) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(s) }),
  deleteScenario: (id: string) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createRun: (scenarioId: string, input: string) => j<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ scenarioId, input }) }).then((r) => r.runId),
  listRuns: (scenarioId?: string) => j<{ runs: RunSummary[] }>(`/api/runs${scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ""}`).then((r) => r.runs),
  getRun: (runId: string) => j<{ run: unknown }>(`/api/runs/${encodeURIComponent(runId)}`).then((r) => r.run),
  runEvents: (runId: string) => new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`),
  spawn: (body: { name: string; provider?: string; model?: string; purpose?: string; color?: string }) => j("/api/agents/spawn", { method: "POST", body: JSON.stringify(body) }),
  kill: (session: string) => j("/api/agents/kill", { method: "POST", body: JSON.stringify({ session }) }),
  agents: () => j<{ sessions: string[] }>("/api/agents"),
};
