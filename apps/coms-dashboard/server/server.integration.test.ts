import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, seedScenarios } from "./db";
import { buildServer } from "./index";
import type { ScenarioDef } from "../src/lib/orchestration/types";

const scn: ScenarioDef = {
  id: "demo", title: "Demo", blurb: "b",
  roles: [{ name: "a", provider: "x", model: "x", purpose: "", color: "#000" }],
  input: { label: "l", default: "d" },
  steps: [{ id: "s1", role: "a", prompt: "{{input}}", after: [] }],
  assembly: "R:{{steps.s1}}",
};

function harness() {
  const db = new Database(":memory:"); migrate(db); seedScenarios(db, [scn]);
  const hub = { ask: async (_r: string, _p: string, _t: number) => "hello" };
  const agents = { spawnMissing: async () => true };
  const handler = buildServer({ db, hub, agents, awaitRuns: true });
  return { handler };
}
async function call(handler: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) {
  return handler(new Request("http://t" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
}

test("GET /api/scenarios 返回 seed 的内置场景", async () => {
  const { handler } = harness();
  const res = await call(handler, "GET", "/api/scenarios");
  const j = await res.json();
  expect(j.scenarios.map((s: { id: string }) => s.id)).toContain("demo");
});

test("POST /api/runs 触发服务端编排并落库,GET /api/runs/:id 拿到 result", async () => {
  const { handler } = harness();
  const res = await call(handler, "POST", "/api/runs", { scenarioId: "demo", input: "X" });
  const { runId } = await res.json();
  expect(runId).toBeTruthy();
  const detail = await (await call(handler, "GET", `/api/runs/${runId}`)).json();
  expect(detail.run.status).toBe("done");
  expect(detail.run.result_md).toBe("R:hello");
});

test("PUT 内置场景被拒(409)", async () => {
  const { handler } = harness();
  const res = await call(handler, "PUT", "/api/scenarios/demo", scn);
  expect(res.status).toBe(409);
});
