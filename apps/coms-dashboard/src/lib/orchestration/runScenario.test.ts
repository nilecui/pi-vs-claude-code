// src/lib/orchestration/runScenario.test.ts
import { expect, test } from "bun:test";
import { runScenario, assemble, TIMEOUT_TEXT, DELEGATION_SUFFIX } from "./runScenario";
import type { ScenarioDef, RunDeps, StepStatus } from "./types";

const role = { name: "a", provider: "p", model: "m", purpose: "", color: "#000" };

// 标书式拓扑:tech/comm 并行 → comp 依赖二者 → lead 依赖 comp
function bidScn(): ScenarioDef {
  return {
    id: "bid", title: "t", blurb: "b",
    roles: [
      { ...role, name: "tw" }, { ...role, name: "cm" },
      { ...role, name: "cp" }, { ...role, name: "ld" },
    ],
    input: { label: "l", default: "d" },
    steps: [
      { id: "tech", role: "tw", prompt: "T:{{input}}", after: [] },
      { id: "comm", role: "cm", prompt: "C:{{input}}", after: [] },
      { id: "comp", role: "cp", prompt: "{{steps.tech}}|{{steps.comm}}", after: ["tech", "comm"] },
      { id: "lead", role: "ld", prompt: "{{steps.comp}}", after: ["comp"] },
    ],
    assembly: "FINAL {{steps.lead}}",
  };
}

function deps(over: Partial<RunDeps>): RunDeps {
  return {
    ask: async (role, _prompt) => `out-${role}`,
    spawnMissing: async () => true,
    onStepUpdate: () => {},
    onStatus: () => {},
    onResult: () => {},
    ...over,
  };
}

test("拓扑执行:tech/comm 在 comp 之前,comp 在 lead 之前", async () => {
  const order: string[] = [];
  await runScenario(bidScn(), "X", deps({
    ask: async (role) => { order.push(role); return `out-${role}`; },
  }));
  expect(order.indexOf("tw")).toBeLessThan(order.indexOf("cp"));
  expect(order.indexOf("cm")).toBeLessThan(order.indexOf("cp"));
  expect(order.indexOf("cp")).toBeLessThan(order.indexOf("ld"));
});

test("prompt 用上游产出插值,并追加禁止转发后缀", async () => {
  const seen: Record<string, string> = {};
  await runScenario(bidScn(), "X", deps({
    ask: async (role, prompt) => { seen[role] = prompt; return `out-${role}`; },
  }));
  expect(seen["tw"]).toContain("T:X");
  expect(seen["cp"]).toContain("out-tw|out-cm");
  expect(seen["tw"]).toContain(DELEGATION_SUFFIX.trim().slice(0, 8));
});

test("onResult 收到装配后的最终产出", async () => {
  let result = "";
  await runScenario(bidScn(), "X", deps({ onResult: (r) => { result = r; } }));
  expect(result).toBe("FINAL out-ld");
});

test("校验失败 → onStatus 报错且不执行 ask", async () => {
  let asked = false;
  let status = "";
  const bad = { ...bidScn(), steps: [{ id: "x", role: "ghost", prompt: "", after: [] }] };
  await runScenario(bad, "X", deps({
    ask: async () => { asked = true; return ""; },
    onStatus: (m) => { status = m; },
  }));
  expect(asked).toBe(false);
  expect(status).toContain("校验失败");
});

test("spawnMissing 失败 → 不执行 ask", async () => {
  let asked = false;
  await runScenario(bidScn(), "X", deps({
    spawnMissing: async () => false,
    ask: async () => { asked = true; return ""; },
  }));
  expect(asked).toBe(false);
});

test("某步超时 → 标记 timeout,下游仍运行且收到占位符", async () => {
  const statuses: Record<string, StepStatus> = {};
  let compPrompt = "";
  await runScenario(bidScn(), "X", deps({
    ask: async (role, prompt) => {
      if (role === "tw") return TIMEOUT_TEXT;
      if (role === "cp") compPrompt = prompt;
      return `out-${role}`;
    },
    onStepUpdate: (id, st) => { statuses[id] = st; },
  }));
  expect(statuses["tech"]).toBe("timeout");
  expect(statuses["comp"]).toBe("done");
  expect(compPrompt).toContain(TIMEOUT_TEXT); // 下游拿到上游超时占位符
});

test("assemble 缺省 = 汇点步骤产出拼接", () => {
  const s = bidScn();
  delete s.assembly;
  // lead 是唯一汇点(没有别的 step 在 after 里引用它)
  expect(assemble(s, { tech: "a", comm: "b", comp: "c", lead: "d" })).toBe("d");
});

test("某步抛错 → 标记 error,下游仍运行", async () => {
  const statuses: Record<string, StepStatus> = {};
  let compRan = false;
  await runScenario(bidScn(), "X", deps({
    ask: async (role) => {
      if (role === "tw") throw new Error("boom");
      if (role === "cp") compRan = true;
      return `out-${role}`;
    },
    onStepUpdate: (id, st) => { statuses[id] = st; },
  }));
  expect(statuses["tech"]).toBe("error");
  expect(compRan).toBe(true);
  expect(statuses["comp"]).toBe("done");
});

test("assemble 多汇点(无 assembly)→ 以 \\n\\n---\\n\\n 连接", () => {
  const s: ScenarioDef = {
    id: "multi", title: "t", blurb: "b",
    roles: [{ ...role, name: "x" }, { ...role, name: "y" }],
    input: { label: "l", default: "d" },
    steps: [
      { id: "s1", role: "x", prompt: "{{input}}", after: [] },
      { id: "s2", role: "y", prompt: "{{input}}", after: [] },
    ],
    // 无 assembly,s1/s2 均为汇点
  };
  expect(assemble(s, { s1: "A", s2: "B" })).toBe("A\n\n---\n\nB");
});
