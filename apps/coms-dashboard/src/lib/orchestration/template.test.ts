// src/lib/orchestration/template.test.ts
import { expect, test } from "bun:test";
import { render, collectRefs } from "./template";

test("render 替换 {{input}}", () => {
  expect(render("任务:{{input}}", { input: "做X", steps: {} })).toBe("任务:做X");
});

test("render 替换 {{steps.<id>}}(含连字符 id)", () => {
  expect(render("A={{steps.lead-a}}", { input: "", steps: { "lead-a": "答A" } })).toBe("A=答A");
});

test("render 未知 step 引用 → 空串", () => {
  expect(render("X={{steps.nope}}", { input: "", steps: {} })).toBe("X=");
});

test("render 容忍内部空格", () => {
  expect(render("{{ input }} {{ steps.t }}", { input: "i", steps: { t: "v" } })).toBe("i v");
});

test("collectRefs 报告 input 与 step 引用(去重)", () => {
  const r = collectRefs("{{input}} {{steps.a}} {{steps.a}} {{steps.b}}");
  expect(r.input).toBe(true);
  expect(r.steps.sort()).toEqual(["a", "b"]);
});

test("collectRefs 无 input 时 input=false", () => {
  expect(collectRefs("{{steps.a}}").input).toBe(false);
});
