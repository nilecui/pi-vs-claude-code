import type { Database } from "bun:sqlite";
import { runScenario } from "../src/lib/orchestration/runScenario";
import type { ScenarioDef, RoleDef } from "../src/lib/orchestration/types";
import { createRun, updateRunStatus, upsertRunStep } from "./db";
import type { RunHub, RunEvent } from "./runHub";

export interface RunnerArgs {
  db: Database;
  hub: { ask: (role: string, prompt: string, timeoutMs: number) => Promise<string> };
  agents: { spawnMissing: (roles: RoleDef[]) => Promise<boolean> };
  runHub: RunHub;
  scenario: ScenarioDef;
  input: string;
  ownerId: string;
  runId?: string; // Task 6 adjustment: optional pre-created runId
  onEvent?: (e: RunEvent) => void; // 测试用旁路;生产用 runHub
  onSubscribeReplay?: boolean; // accepted but unused (future use)
}

export async function startRun(args: RunnerArgs): Promise<string> {
  const { db, hub, agents, runHub, scenario, input } = args;
  const runId = args.runId ?? createRun(db, scenario.id, input, args.ownerId);
  const emit = (e: RunEvent) => { runHub.broadcast(runId, e); args.onEvent?.(e); };
  try {
    await runScenario(scenario, input, {
      ask: (role, prompt, timeoutMs) => hub.ask(role, prompt, timeoutMs),
      spawnMissing: (roles) => agents.spawnMissing(roles),
      onStepUpdate: (id, status, text) => {
        const role = scenario.steps.find((s) => s.id === id)?.role ?? "";
        upsertRunStep(db, runId, id, role, status, text);
        emit({ type: "step", stepId: id, role, status, output: text });
      },
      onStatus: (msg) => { if (/校验失败|未就绪|异常中止/.test(msg)) updateRunStatus(db, runId, "error"); emit({ type: "status", msg }); },
      onResult: (md) => { updateRunStatus(db, runId, "done", md); emit({ type: "result", md }); emit({ type: "done" }); },
    });
  } catch (e) {
    updateRunStatus(db, runId, "error");
    emit({ type: "error", error: String(e) });
  }
  return runId;
}
