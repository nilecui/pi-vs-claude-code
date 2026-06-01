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
  expect(listScenarios(db, "u1").map((s) => s.id).sort()).toEqual(["x", "y"]);
  expect(listScenarios(db, "u1").every((s) => s.builtin === 1)).toBe(true);
});

test("upsert / get / delete 自定义场景", () => {
  const db = freshDb();
  upsertScenario(db, demo, false, "u1");
  expect(getScenario(db, undefined, "u1")).toBeNull(); // 无 id
  const got = getScenario(db, "x", "u1");
  expect(got?.steps[0].id).toBe("s1");
  deleteScenario(db, "x");
  expect(getScenario(db, "x", "u1")).toBeNull();
});

test("run + steps 读写与状态更新", () => {
  const db = freshDb();
  upsertScenario(db, demo, false, "u1");
  const runId = createRun(db, "x", "input-text", "u1");
  upsertRunStep(db, runId, "s1", "a", "running", undefined);
  upsertRunStep(db, runId, "s1", "a", "done", "out-1");
  updateRunStatus(db, runId, "done", "FINAL");
  const run = getRun(db, runId, "u1");
  expect(run?.status).toBe("done");
  expect(run?.result_md).toBe("FINAL");
  expect(run?.steps.length).toBe(1);
  expect(run?.steps[0].status).toBe("done");
  expect(run?.steps[0].output).toBe("out-1");
  expect(listRuns(db, "u1", "x").length).toBe(1);
});

test("owner 隔离:listScenarios 只见本人 + 内置(NULL)", () => {
  const db = freshDb();
  upsertScenario(db, { ...demo, id: "mine" }, false, "u1");
  upsertScenario(db, { ...demo, id: "theirs" }, false, "u2");
  upsertScenario(db, { ...demo, id: "builtin" }, true, null);
  expect(listScenarios(db, "u1").map((s) => s.id).sort()).toEqual(["builtin", "mine"]);
});

test("越权 getScenario/getRun 返回 null", () => {
  const db = freshDb();
  upsertScenario(db, { ...demo, id: "mine" }, false, "u1");
  expect(getScenario(db, "mine", "u2")).toBeNull();
  const rid = createRun(db, "mine", "i", "u1");
  expect(getRun(db, rid, "u2")).toBeNull();
  expect(getRun(db, rid, "u1")?.id).toBe(rid);
});

test("listRuns 按 owner 过滤", () => {
  const db = freshDb();
  upsertScenario(db, demo, false, "u1");
  createRun(db, "x", "a", "u1"); createRun(db, "x", "b", "u2");
  expect(listRuns(db, "u1").length).toBe(1);
  expect(listRuns(db, "u2").length).toBe(1);
});
