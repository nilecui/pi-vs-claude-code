import { Database } from "bun:sqlite";
import type { ScenarioDef } from "../src/lib/orchestration/types";

export type RunStatus = "running" | "done" | "error" | "aborted";
export type StepStatus = "pending" | "running" | "done" | "error" | "timeout";

export interface ScenarioRow { id: string; title: string; blurb: string; builtin: number; }
export interface RunStepRow { step_id: string; role: string; status: StepStatus; output: string | null; }
export interface RunRow {
  id: string; scenario_id: string; input: string; status: RunStatus;
  result_md: string | null; created_at: number; finished_at: number | null; steps: RunStepRow[];
}

export function migrate(db: Database): void {
  db.run("PRAGMA journal_mode=WAL");
  db.run(`CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, blurb TEXT NOT NULL, data TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL,
    result_md TEXT, created_at INTEGER NOT NULL, finished_at INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
    role TEXT NOT NULL, status TEXT NOT NULL, output TEXT, started_at INTEGER, finished_at INTEGER)`);
  db.run("CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id)");
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  for (const t of ["scenarios", "runs"]) {
    const cols = db.query(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "owner_id")) db.run(`ALTER TABLE ${t} ADD COLUMN owner_id TEXT`);
  }
  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id))`);
  {
    const cols = db.query(`PRAGMA table_info(scenarios)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "team_id")) db.run(`ALTER TABLE scenarios ADD COLUMN team_id TEXT`);
  }
  {
    const cols = db.query(`PRAGMA table_info(users)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "oauth_sub")) db.run(`ALTER TABLE users ADD COLUMN oauth_sub TEXT`);
  }
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_sub ON users(oauth_sub) WHERE oauth_sub IS NOT NULL");
}

export function seedScenarios(db: Database, builtins: ScenarioDef[]): void {
  const exists = db.query("SELECT COUNT(*) AS n FROM scenarios").get() as { n: number };
  if (exists.n > 0) return; // 幂等:已有则不重复 seed
  for (const s of builtins) upsertScenario(db, s, true, null);
}

export function listScenarios(db: Database, userId: string): ScenarioRow[] {
  return db.query(
    `SELECT id, title, blurb, builtin FROM scenarios
     WHERE owner_id = ? OR owner_id IS NULL OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
     ORDER BY builtin DESC, title`,
  ).all(userId, userId) as ScenarioRow[];
}

export function getScenario(db: Database, id: string | undefined, userId: string): ScenarioDef | null {
  if (!id) return null;
  const row = db.query("SELECT data, owner_id, team_id FROM scenarios WHERE id = ?").get(id) as { data: string; owner_id: string | null; team_id: string | null } | null;
  if (!row) return null;
  const visible = row.owner_id === null || row.owner_id === userId ||
    (row.team_id !== null && !!db.query("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").get(row.team_id, userId));
  return visible ? (JSON.parse(row.data) as ScenarioDef) : null;
}

export function getScenarioTeamId(db: Database, id: string): string | null {
  const row = db.query("SELECT team_id FROM scenarios WHERE id = ?").get(id) as { team_id: string | null } | null;
  return row?.team_id ?? null;
}

export function isScenarioOwner(db: Database, id: string, userId: string): boolean {
  const row = db.query("SELECT owner_id FROM scenarios WHERE id = ?").get(id) as { owner_id: string | null } | null;
  return !!row && row.owner_id === userId;
}

export function isBuiltin(db: Database, id: string): boolean {
  const row = db.query("SELECT builtin FROM scenarios WHERE id = ?").get(id) as { builtin: number } | null;
  return !!row && row.builtin === 1;
}

export function upsertScenario(db: Database, s: ScenarioDef, builtin: boolean, ownerId: string | null, teamId: string | null = null): void {
  const now = Date.now();
  db.run(
    `INSERT INTO scenarios (id, title, blurb, data, builtin, owner_id, team_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, blurb=excluded.blurb,
       data=excluded.data, owner_id=excluded.owner_id, team_id=excluded.team_id, updated_at=excluded.updated_at`,
    [s.id, s.title, s.blurb, JSON.stringify(s), builtin ? 1 : 0, ownerId, teamId, now, now],
  );
}

export function deleteScenario(db: Database, id: string): void {
  db.run("DELETE FROM scenarios WHERE id = ?", [id]);
}

export function createRun(db: Database, scenarioId: string, input: string, ownerId: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO runs (id, scenario_id, input, status, owner_id, created_at) VALUES (?, ?, ?, 'running', ?, ?)",
    [id, scenarioId, input, ownerId, Date.now()]);
  return id;
}

export function updateRunStatus(db: Database, runId: string, status: RunStatus, resultMd?: string): void {
  db.run("UPDATE runs SET status = ?, result_md = ?, finished_at = ? WHERE id = ?",
    [status, resultMd ?? null, Date.now(), runId]);
}

export function upsertRunStep(db: Database, runId: string, stepId: string, role: string,
                              status: StepStatus, output?: string): void {
  const existing = db.query("SELECT id FROM run_steps WHERE run_id = ? AND step_id = ?").get(runId, stepId) as { id: number } | null;
  const now = Date.now();
  if (existing) {
    db.run("UPDATE run_steps SET status = ?, output = ?, finished_at = ? WHERE id = ?",
      [status, output ?? null, status === "running" ? null : now, existing.id]);
  } else {
    db.run("INSERT INTO run_steps (run_id, step_id, role, status, output, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [runId, stepId, role, status, output ?? null, now, status === "running" ? null : now]);
  }
}

// 该 run 的场景是否对 userId 经团队可见(场景 team_id ∈ 用户所属团队)
function isRunScenarioVisible(db: Database, scenarioId: string, userId: string): boolean {
  return !!db.query(
    `SELECT 1 FROM scenarios s JOIN team_members m ON m.team_id = s.team_id WHERE s.id = ? AND m.user_id = ?`,
  ).get(scenarioId, userId);
}

export function getRun(db: Database, runId: string, userId: string): RunRow | null {
  const run = db.query(
    `SELECT r.*, u.username AS owner_name FROM runs r LEFT JOIN users u ON u.id = r.owner_id WHERE r.id = ?`,
  ).get(runId) as (Omit<RunRow, "steps"> & { owner_id: string | null; owner_name: string | null }) | null;
  if (!run) return null;
  const visible = run.owner_id === userId || isRunScenarioVisible(db, run.scenario_id, userId);
  if (!visible) return null;
  const steps = db.query("SELECT step_id, role, status, output FROM run_steps WHERE run_id = ? ORDER BY id").all(runId) as RunStepRow[];
  return { ...run, steps };
}

export function listRuns(db: Database, userId: string, scenarioId?: string): (Omit<RunRow, "steps"> & { owner_name: string | null })[] {
  const visTeam = `r.scenario_id IN (SELECT s.id FROM scenarios s JOIN team_members m ON m.team_id = s.team_id WHERE m.user_id = ?)`;
  const sel = `SELECT r.*, u.username AS owner_name FROM runs r LEFT JOIN users u ON u.id = r.owner_id`;
  if (scenarioId) {
    return db.query(`${sel} WHERE r.scenario_id = ? AND (r.owner_id = ? OR ${visTeam}) ORDER BY r.created_at DESC`)
      .all(scenarioId, userId, userId) as (Omit<RunRow, "steps"> & { owner_name: string | null })[];
  }
  return db.query(`${sel} WHERE r.owner_id = ? OR ${visTeam} ORDER BY r.created_at DESC`)
    .all(userId, userId) as (Omit<RunRow, "steps"> & { owner_name: string | null })[];
}

export function abortStaleRuns(db: Database): void {
  db.run("UPDATE runs SET status = 'aborted', finished_at = ? WHERE status = 'running'", [Date.now()]);
}
