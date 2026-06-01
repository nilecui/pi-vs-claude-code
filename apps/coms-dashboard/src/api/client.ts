import type { ScenarioDef } from "../lib/orchestration/types";

export interface ScenarioSummary { id: string; title: string; blurb: string; builtin: number; }
export interface RunSummary { id: string; scenario_id: string; input: string; status: string; result_md: string | null; created_at: number; finished_at: number | null; owner_name: string | null; }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

export interface AuthUser { id: string; username: string; }
export const auth = {
  me: () => j<{ user: AuthUser }>("/api/auth/me").then((r) => r.user),
  login: (username: string, password: string) => j<{ user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }).then((r) => r.user),
  register: (username: string, password: string) => j<{ user: AuthUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }).then((r) => r.user),
  logout: () => j("/api/auth/logout", { method: "POST" }),
};

export interface TeamSummary { id: string; name: string; owner_id: string; role: string; }
export interface TeamMember { user_id: string; username: string; role: string; }
export interface TeamDetail { id: string; name: string; owner_id: string; members: TeamMember[]; }
export const teams = {
  list: () => j<{ teams: TeamSummary[] }>("/api/teams").then((r) => r.teams),
  create: (name: string) => j<{ id: string }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) }),
  get: (id: string) => j<{ team: TeamDetail }>(`/api/teams/${encodeURIComponent(id)}`).then((r) => r.team),
  addMember: (id: string, username: string) => j(`/api/teams/${encodeURIComponent(id)}/members`, { method: "POST", body: JSON.stringify({ username }) }),
  removeMember: (id: string, userId: string) => j(`/api/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  remove: (id: string) => j(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const api = {
  listScenarios: () => j<{ scenarios: ScenarioSummary[] }>("/api/scenarios").then((r) => r.scenarios),
  getScenario: (id: string) => j<{ scenario: ScenarioDef; teamId: string | null }>(`/api/scenarios/${encodeURIComponent(id)}`).then((r) => r.scenario),
  getScenarioFull: (id: string) => j<{ scenario: ScenarioDef; teamId: string | null }>(`/api/scenarios/${encodeURIComponent(id)}`),
  createScenario: (s: ScenarioDef, teamId: string | null = null) => j<{ ok: boolean; id: string }>("/api/scenarios", { method: "POST", body: JSON.stringify({ ...s, teamId }) }),
  duplicateScenario: (id: string) => j<{ ok: boolean; id: string }>(`/api/scenarios/${encodeURIComponent(id)}/duplicate`, { method: "POST" }),
  updateScenario: (id: string, s: ScenarioDef, teamId: string | null = null) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...s, teamId }) }),
  deleteScenario: (id: string) => j(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createRun: (scenarioId: string, input: string) => j<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ scenarioId, input }) }).then((r) => r.runId),
  listRuns: (scenarioId?: string) => j<{ runs: RunSummary[] }>(`/api/runs${scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ""}`).then((r) => r.runs),
  getRun: (runId: string) => j<{ run: unknown }>(`/api/runs/${encodeURIComponent(runId)}`).then((r) => r.run),
  runEvents: (runId: string) => new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`),
  spawn: (body: { name: string; provider?: string; model?: string; purpose?: string; color?: string }) => j("/api/agents/spawn", { method: "POST", body: JSON.stringify(body) }),
  kill: (session: string) => j("/api/agents/kill", { method: "POST", body: JSON.stringify({ session }) }),
  agents: () => j<{ sessions: string[] }>("/api/agents"),
};
