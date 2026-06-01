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
async function call(handler: (r: Request) => Promise<Response>, method: string, path: string, cookie?: string, body?: unknown) {
  return handler(new Request("http://t" + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
}
async function register(handler: (r: Request) => Promise<Response>, username = "u1", password = "p1") {
  const res = await call(handler, "POST", "/api/auth/register", undefined, { username, password });
  return res.headers.get("set-cookie")!.split(";")[0]; // coms_session=...
}

test("/api/health 免鉴权;无 cookie 调 /api/scenarios → 401", async () => {
  const { handler } = harness();
  expect((await call(handler, "GET", "/api/health")).status).toBe(200);
  expect((await call(handler, "GET", "/api/scenarios")).status).toBe(401);
});

test("/api/auth/me:无 cookie 401,注册后 200", async () => {
  const { handler } = harness();
  expect((await call(handler, "GET", "/api/auth/me")).status).toBe(401);
  const cookie = await register(handler);
  const me = await (await call(handler, "GET", "/api/auth/me", cookie)).json();
  expect(me.user.username).toBe("u1");
});

test("带 cookie GET /api/scenarios 返回 seed 的内置场景", async () => {
  const { handler } = harness();
  const cookie = await register(handler);
  const j = await (await call(handler, "GET", "/api/scenarios", cookie)).json();
  expect(j.scenarios.map((s: { id: string }) => s.id)).toContain("demo");
});

test("POST /api/runs 触发服务端编排并落库,GET /api/runs/:id 拿到 result", async () => {
  const { handler } = harness();
  const cookie = await register(handler);
  const res = await call(handler, "POST", "/api/runs", cookie, { scenarioId: "demo", input: "X" });
  const { runId } = await res.json();
  expect(runId).toBeTruthy();
  const detail = await (await call(handler, "GET", `/api/runs/${runId}`, cookie)).json();
  expect(detail.run.status).toBe("done");
  expect(detail.run.result_md).toBe("R:hello");
});

test("PUT 内置场景被拒(409)", async () => {
  const { handler } = harness();
  const cookie = await register(handler);
  const res = await call(handler, "PUT", "/api/scenarios/demo", cookie, scn);
  expect(res.status).toBe(409);
});

test("团队共享:成员可见且只读,非成员不可见", async () => {
  const { handler } = harness();
  const a = await register(handler, "ta", "p");
  const b = await register(handler, "tb", "p");
  const c = await register(handler, "tc", "p");
  const { id: teamId } = await (await call(handler, "POST", "/api/teams", a, { name: "dev" })).json();
  expect((await call(handler, "POST", `/api/teams/${teamId}/members`, a, { username: "tb" })).status).toBe(200);
  const scnX = { id: "shareX", title: "X", blurb: "b", roles: [{ name: "r", provider: "x", model: "x", purpose: "", color: "#000" }], input: { label: "l", default: "d" }, steps: [{ id: "s1", role: "r", prompt: "{{input}}", after: [] }], teamId };
  expect((await call(handler, "POST", "/api/scenarios", a, scnX)).status).toBe(200);
  // b 成员可见,但 PUT 403
  expect((await (await call(handler, "GET", "/api/scenarios", b)).json()).scenarios.map((s: { id: string }) => s.id)).toContain("shareX");
  expect((await call(handler, "PUT", "/api/scenarios/shareX", b, { ...scnX, teamId: null })).status).toBe(403);
  // c 非成员不可见
  expect((await (await call(handler, "GET", "/api/scenarios", c)).json()).scenarios.map((s: { id: string }) => s.id)).not.toContain("shareX");
  expect((await call(handler, "GET", "/api/scenarios/shareX", c)).status).toBe(404);
});

test("run 团队可见:同队成员看得到队友对共享场景的 run", async () => {
  const { handler } = harness();
  const a = await register(handler, "ra", "p");
  const b = await register(handler, "rb", "p");
  const c = await register(handler, "rc", "p");
  const { id: teamId } = await (await call(handler, "POST", "/api/teams", a, { name: "dev" })).json();
  await call(handler, "POST", `/api/teams/${teamId}/members`, a, { username: "rb" });
  const scn = { id: "rshare", title: "X", blurb: "b", roles: [{ name: "r", provider: "x", model: "x", purpose: "", color: "#000" }], input: { label: "l", default: "d" }, steps: [{ id: "s1", role: "r", prompt: "{{input}}", after: [] }], assembly: "R:{{steps.s1}}", teamId };
  await call(handler, "POST", "/api/scenarios", a, scn);
  const { runId } = await (await call(handler, "POST", "/api/runs", a, { scenarioId: "rshare", input: "X" })).json();
  const bRuns = await (await call(handler, "GET", "/api/runs?scenarioId=rshare", b)).json();
  expect(bRuns.runs.length).toBe(1);
  expect(bRuns.runs[0].owner_name).toBe("ra");
  expect((await call(handler, "GET", `/api/runs/${runId}`, b)).status).toBe(200);
  expect((await (await call(handler, "GET", "/api/runs?scenarioId=rshare", c)).json()).runs.length).toBe(0);
  expect((await call(handler, "GET", `/api/runs/${runId}`, c)).status).toBe(404);
});

test("用户隔离:A 的 run,B 看不到", async () => {
  const { handler } = harness();
  const a = await register(handler, "alice", "pw");
  const b = await register(handler, "bob", "pw");
  const { runId } = await (await call(handler, "POST", "/api/runs", a, { scenarioId: "demo", input: "X" })).json();
  // B 列表看不到 A 的 run
  const bRuns = await (await call(handler, "GET", "/api/runs", b)).json();
  expect(bRuns.runs.length).toBe(0);
  // B 直接取 A 的 run → 404
  expect((await call(handler, "GET", `/api/runs/${runId}`, b)).status).toBe(404);
  // A 自己能看到
  const aRuns = await (await call(handler, "GET", "/api/runs", a)).json();
  expect(aRuns.runs.length).toBe(1);
});
