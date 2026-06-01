// src/lib/orchestration/validate.test.ts
import { expect, test } from "bun:test";
import { validate } from "./validate";
import type { ScenarioDef } from "./types";

const role = { name: "a", provider: "p", model: "m", purpose: "", color: "#000" };
function scn(over: Partial<ScenarioDef>): ScenarioDef {
  return {
    id: "s", title: "t", blurb: "b",
    roles: [role],
    input: { label: "l", default: "d" },
    steps: [{ id: "s1", role: "a", prompt: "{{input}}", after: [] }],
    ...over,
  };
}

test("合法场景 → 无错误", () => {
  expect(validate(scn({}))).toEqual([]);
});

test("空 roles / 空 steps 报错", () => {
  const e = validate(scn({ roles: [], steps: [] }));
  expect(e.some((x) => x.includes("roles"))).toBe(true);
  expect(e.some((x) => x.includes("steps"))).toBe(true);
});

test("重复 step id 报错", () => {
  const e = validate(scn({ steps: [
    { id: "s1", role: "a", prompt: "", after: [] },
    { id: "s1", role: "a", prompt: "", after: [] },
  ] }));
  expect(e.some((x) => x.includes("重复"))).toBe(true);
});

test("step 引用未定义 role 报错", () => {
  const e = validate(scn({ steps: [{ id: "s1", role: "ghost", prompt: "", after: [] }] }));
  expect(e.some((x) => x.includes("role") && x.includes("ghost"))).toBe(true);
});

test("after 引用不存在的 step 报错", () => {
  const e = validate(scn({ steps: [{ id: "s1", role: "a", prompt: "", after: ["nope"] }] }));
  expect(e.some((x) => x.includes("after") && x.includes("nope"))).toBe(true);
});

test("prompt 模板引用不存在的 step 报错", () => {
  const e = validate(scn({ steps: [{ id: "s1", role: "a", prompt: "{{steps.nope}}", after: [] }] }));
  expect(e.some((x) => x.includes("prompt") && x.includes("nope"))).toBe(true);
});

test("环依赖报错", () => {
  const e = validate(scn({ steps: [
    { id: "s1", role: "a", prompt: "", after: ["s2"] },
    { id: "s2", role: "a", prompt: "", after: ["s1"] },
  ] }));
  expect(e.some((x) => x.includes("环"))).toBe(true);
});
