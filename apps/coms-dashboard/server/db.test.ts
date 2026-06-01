import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, seedScenarios, listScenarios, getScenario, upsertScenario, deleteScenario,
         createRun, updateRunStatus, upsertRunStep, getRun, listRuns } from "./db";
import type { ScenarioDef } from "../src/lib/orchestration/types";

function freshDb() { const db = new Database(":memory:"); migrate(db); return db; }
const demo: ScenarioDef = {
  id: "x", title: "X", blurb: "b",
  roles: [{ name: "a", provider: "p", model: "m", purpose: "", color: "#000" }],
  input: { label: "l", default: "d" },
  steps: [{ id: "s1", role: "a", prompt: "{{input}}", after: [] }],
};

test("migrate + seed 写入内置场景且幂等", () => {
  const db = freshDb();
  const builtins: ScenarioDef[] = [demo, { ...demo, id: "y" }];
  seedScenarios(db, builtins);
  seedScenarios(db, builtins); // 第二次不应重复
  expect(listScenarios(db).map((s) => s.id).sort()).toEqual(["x", "y"]);
  expect(listScenarios(db).every((s) => s.builtin === 1)).toBe(true);
});

test("upsert / get / delete 自定义场景", () => {
  const db = freshDb();
  upsertScenario(db, demo, false);
  expect(getScenario(db)?.id).toBeUndefined(); // getScenario 需要 id 参数
  const got = getScenario(db, "x");
  expect(got?.steps[0].id).toBe("s1");
  deleteScenario(db, "x");
  expect(getScenario(db, "x")).toBeNull();
});

test("run + steps 读写与状态更新", () => {
  const db = freshDb();
  upsertScenario(db, demo, false);
  const runId = createRun(db, "x", "input-text");
  upsertRunStep(db, runId, "s1", "a", "running", undefined);
  upsertRunStep(db, runId, "s1", "a", "done", "out-1");
  updateRunStatus(db, runId, "done", "FINAL");
  const run = getRun(db, runId);
  expect(run?.status).toBe("done");
  expect(run?.result_md).toBe("FINAL");
  expect(run?.steps.length).toBe(1);
  expect(run?.steps[0].status).toBe("done");
  expect(run?.steps[0].output).toBe("out-1");
  expect(listRuns(db, "x").length).toBe(1);
});
