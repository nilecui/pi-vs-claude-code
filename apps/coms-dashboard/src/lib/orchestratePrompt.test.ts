import { expect, test } from "bun:test";
import { orchestratePrompt } from "./orchestratePrompt";

test("mentions target name and task", () => {
  const p = orchestratePrompt("bob", "ask for the API spec");
  expect(p).toContain('"bob"');
  expect(p).toContain("ask for the API spec");
});

test("includes an anti-loop termination instruction", () => {
  const p = orchestratePrompt("bob", "x");
  expect(p.toLowerCase()).toContain("do not loop");
});

test("tells the agent to report back", () => {
  expect(orchestratePrompt("bob", "x").toLowerCase()).toContain("report");
});
