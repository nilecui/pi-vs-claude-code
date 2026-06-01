// src/lib/orchestration/scenarios.test.ts
import { expect, test } from "bun:test";
import { SCENARIOS } from "./scenarios";
import { validate } from "./validate";

test("内置 3 个场景,id 为 hierarchy/bid/contract", () => {
  expect(SCENARIOS.map((s) => s.id).sort()).toEqual(["bid", "contract", "hierarchy"]);
});

test("每个内置场景都通过校验", () => {
  for (const s of SCENARIOS) {
    expect(validate(s)).toEqual([]);
  }
});

test("标书场景:tech/comm 无依赖,comp 依赖两者,lead 依赖 comp", () => {
  const bid = SCENARIOS.find((s) => s.id === "bid")!;
  const by = Object.fromEntries(bid.steps.map((st) => [st.id, st]));
  expect(by["tech"].after).toEqual([]);
  expect(by["comm"].after).toEqual([]);
  expect(by["comp"].after.sort()).toEqual(["comm", "tech"]);
  expect(by["lead"].after).toEqual(["comp"]);
});

test("合同场景:risk 角色被两个 step 复用(risk + recheck)", () => {
  const c = SCENARIOS.find((s) => s.id === "contract")!;
  const riskSteps = c.steps.filter((st) => st.role === "risk-reviewer");
  expect(riskSteps.map((st) => st.id).sort()).toEqual(["recheck", "risk"]);
});
