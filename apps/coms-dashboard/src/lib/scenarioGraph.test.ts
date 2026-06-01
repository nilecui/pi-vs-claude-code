import { expect, test } from "bun:test";
import { scenarioToGraph } from "./scenarioGraph";
import type { ScenarioDef } from "./orchestration/types";

function scn(steps: ScenarioDef["steps"]): ScenarioDef {
  return { id: "s", title: "t", blurb: "b", roles: [{ name: "r", provider: "p", model: "m", purpose: "", color: "#000" }], input: { label: "", default: "" }, steps };
}

test("空 steps → 空图", () => {
  expect(scenarioToGraph(scn([]))).toEqual({ nodes: [], edges: [] });
});

test("steps + after → nodes/edges", () => {
  const g = scenarioToGraph(scn([
    { id: "a", role: "r", prompt: "", after: [] },
    { id: "b", role: "r", prompt: "", after: ["a"] },
  ]));
  expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  expect(g.nodes.find((n) => n.id === "a")!.label).toContain("a");
  expect(g.edges).toEqual([{ source: "a", target: "b" }]);
});

test("坏 after 引用(指向不存在 step)→ 不产出该边", () => {
  const g = scenarioToGraph(scn([{ id: "a", role: "r", prompt: "", after: ["ghost"] }]));
  expect(g.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(g.edges).toEqual([]);
});

test("自环 after 含自身 → 忽略", () => {
  const g = scenarioToGraph(scn([{ id: "a", role: "r", prompt: "", after: ["a"] }]));
  expect(g.edges).toEqual([]);
});
