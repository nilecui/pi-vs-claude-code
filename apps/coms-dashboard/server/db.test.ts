import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, seedScenarios, listScenarios, getScenario, upsertScenario, deleteScenario,
         createRun, updateRunStatus, upsertRunStep, getRun, listRuns, isScenarioOwner, getScenarioTeamId } from "./db";
import { createUser } from "./auth";
import { createTeam, addMember } from "./teams";
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

test("团队共享场景:成员可见、非成员不可见", () => {
  const db = freshDb();
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h"); const c = createUser(db, "carol", "h");
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob");
  upsertScenario(db, { ...demo, id: "shared" }, false, a, t);
  expect(listScenarios(db, b).map((s) => s.id)).toContain("shared"); // 成员可见
  expect(getScenario(db, "shared", b)?.id).toBe("shared");
  expect(listScenarios(db, c).map((s) => s.id)).not.toContain("shared"); // 非成员不可见
  expect(getScenario(db, "shared", c)).toBeNull();
  expect(isScenarioOwner(db, "shared", a)).toBe(true);
  expect(isScenarioOwner(db, "shared", b)).toBe(false);
  expect(getScenarioTeamId(db, "shared")).toBe(t);
});

test("run 团队可见:成员看队友对共享场景的 run,非成员不可见", () => {
  const db = freshDb();
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h"); const c = createUser(db, "carol", "h");
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob");
  upsertScenario(db, { ...demo, id: "shared" }, false, a, t); // 团队共享
  const rid = createRun(db, "shared", "i", a);                 // a 跑
  const bRuns = listRuns(db, b, "shared");
  expect(bRuns.length).toBe(1);
  expect(bRuns[0].owner_name).toBe("alice");
  expect(getRun(db, rid, b)?.id).toBe(rid);
  expect(listRuns(db, c, "shared").length).toBe(0);
  expect(getRun(db, rid, c)).toBeNull();
});

test("私有场景 run 仍仅 owner 可见(回归)", () => {
  const db = freshDb();
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h");
  upsertScenario(db, { ...demo, id: "priv" }, false, a, null); // 私有
  const rid = createRun(db, "priv", "i", a);
  expect(listRuns(db, b, "priv").length).toBe(0);
  expect(getRun(db, rid, b)).toBeNull();
  expect(getRun(db, rid, a)?.id).toBe(rid);
});
