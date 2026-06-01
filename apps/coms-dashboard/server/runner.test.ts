import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, upsertScenario, getRun } from "./db";
import { RunHub } from "./runHub";
import { startRun } from "./runner";
import type { ScenarioDef } from "../src/lib/orchestration/types";

const scn: ScenarioDef = {
  id: "p", title: "P", blurb: "b",
  roles: [{ name: "a", provider: "x", model: "x", purpose: "", color: "#000" },
          { name: "b", provider: "x", model: "x", purpose: "", color: "#000" }],
  input: { label: "l", default: "d" },
  steps: [
    { id: "s1", role: "a", prompt: "{{input}}", after: [] },
    { id: "s2", role: "b", prompt: "{{steps.s1}}", after: ["s1"] },
  ],
  assembly: "R:{{steps.s2}}",
};

function deps() {
  const db = new Database(":memory:"); migrate(db); upsertScenario(db, scn, false);
  const hub = { ask: async (role: string) => `out-${role}` };
  const agents = { spawnMissing: async () => true };
  const runHub = new RunHub();
  return { db, hub, agents, runHub };
}

test("startRun 落库 steps + result,广播 step/result/done", async () => {
  const { db, hub, agents, runHub } = deps();
  const runId = await startRun({ db, hub, agents, runHub, scenario: scn, input: "X",
    onSubscribeReplay: false });
  // startRun 返回前已跑完(await);也可订阅前先订阅。这里检查 DB。
  const run = getRun(db, runId)!;
  expect(run.status).toBe("done");
  expect(run.result_md).toBe("R:out-b");
  expect(run.steps.map((s) => s.step_id)).toEqual(["s1", "s2"]);
  expect(run.steps.every((s) => s.status === "done")).toBe(true);
});

test("广播事件序列包含 result 与 done", async () => {
  const { db, hub, agents, runHub } = deps();
  const types: string[] = [];
  const runId0 = "pre"; // 订阅需要 runId;改为先 createRun 再 start 的话需要重构。
  // 用 runHub 全局监听:startRun 内部 broadcast 用真实 runId,这里订阅所有 via wildcard 不支持,
  // 所以改为断言 DB(上一个测试)+ 这里断言 onEvent 回调。
  await startRun({ db, hub, agents, runHub, scenario: scn, input: "X",
    onEvent: (e) => types.push(e.type) });
  expect(types).toContain("result");
  expect(types).toContain("done");
});
