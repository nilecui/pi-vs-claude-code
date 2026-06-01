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
}

export function seedScenarios(db: Database, builtins: ScenarioDef[]): void {
  const exists = db.query("SELECT COUNT(*) AS n FROM scenarios").get() as { n: number };
  if (exists.n > 0) return; // 幂等:已有则不重复 seed
  for (const s of builtins) upsertScenario(db, s, true);
}

export function listScenarios(db: Database): ScenarioRow[] {
  return db.query("SELECT id, title, blurb, builtin FROM scenarios ORDER BY builtin DESC, title").all() as ScenarioRow[];
}

export function getScenario(db: Database, id?: string): ScenarioDef | null {
  if (!id) return null;
  const row = db.query("SELECT data FROM scenarios WHERE id = ?").get(id) as { data: string } | null;
  return row ? (JSON.parse(row.data) as ScenarioDef) : null;
}

export function isBuiltin(db: Database, id: string): boolean {
  const row = db.query("SELECT builtin FROM scenarios WHERE id = ?").get(id) as { builtin: number } | null;
  return !!row && row.builtin === 1;
}

export function upsertScenario(db: Database, s: ScenarioDef, builtin: boolean): void {
  const now = Date.now();
  db.run(
    `INSERT INTO scenarios (id, title, blurb, data, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, blurb=excluded.blurb,
       data=excluded.data, updated_at=excluded.updated_at`,
    [s.id, s.title, s.blurb, JSON.stringify(s), builtin ? 1 : 0, now, now],
  );
}

export function deleteScenario(db: Database, id: string): void {
  db.run("DELETE FROM scenarios WHERE id = ?", [id]);
}

export function createRun(db: Database, scenarioId: string, input: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO runs (id, scenario_id, input, status, created_at) VALUES (?, ?, ?, 'running', ?)",
    [id, scenarioId, input, Date.now()]);
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

export function getRun(db: Database, runId: string): RunRow | null {
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(runId) as Omit<RunRow, "steps"> | null;
  if (!run) return null;
  const steps = db.query("SELECT step_id, role, status, output FROM run_steps WHERE run_id = ? ORDER BY id").all(runId) as RunStepRow[];
  return { ...run, steps };
}

export function listRuns(db: Database, scenarioId?: string): Omit<RunRow, "steps">[] {
  if (scenarioId) {
    return db.query("SELECT * FROM runs WHERE scenario_id = ? ORDER BY created_at DESC").all(scenarioId) as Omit<RunRow, "steps">[];
  }
  return db.query("SELECT * FROM runs ORDER BY created_at DESC").all() as Omit<RunRow, "steps">[];
}

export function abortStaleRuns(db: Database): void {
  db.run("UPDATE runs SET status = 'aborted', finished_at = ? WHERE status = 'running'", [Date.now()]);
}
