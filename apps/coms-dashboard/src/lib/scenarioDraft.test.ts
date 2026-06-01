import { expect, test } from "bun:test";
import { blankScenario, addRole, updateRole, removeRole, addStep, updateStep, removeStep, toggleAfter, renameStepId } from "./scenarioDraft";

test("blankScenario 形状", () => {
  const s = blankScenario();
  expect(s).toEqual({ id: "", title: "", blurb: "", roles: [], input: { label: "", default: "" }, steps: [], assembly: "" });
});

test("addRole 自增不重名 + 默认值", () => {
  let s = addRole(blankScenario());
  expect(s.roles[0].name).toBe("role-1");
  expect(s.roles[0].provider).toBe("openai-codex");
  s = addRole(s);
  expect(s.roles[1].name).toBe("role-2");
});

test("updateRole / removeRole", () => {
  let s = addRole(addRole(blankScenario()));
  s = updateRole(s, 0, { name: "boss", purpose: "lead" });
  expect(s.roles[0].name).toBe("boss");
  expect(s.roles[0].purpose).toBe("lead");
  s = removeRole(s, 0);
  expect(s.roles.length).toBe(1);
  expect(s.roles[0].name).toBe("role-2");
});

test("addStep 用第一个角色名 + 自增 id", () => {
  let s = addRole(blankScenario());      // role-1
  s = addStep(s);
  expect(s.steps[0].id).toBe("step-1");
  expect(s.steps[0].role).toBe("role-1");
  s = addStep(s);
  expect(s.steps[1].id).toBe("step-2");
});

test("removeStep 联动从其它步骤 after 摘除被删 id", () => {
  let s = addRole(blankScenario());
  s = addStep(s); s = addStep(s);                 // step-1, step-2
  s = toggleAfter(s, 1, "step-1");                // step-2 依赖 step-1
  expect(s.steps[1].after).toEqual(["step-1"]);
  s = removeStep(s, 0);                           // 删 step-1
  expect(s.steps.length).toBe(1);
  expect(s.steps[0].after).toEqual([]);           // 引用被摘除
});

test("toggleAfter 增/删依赖", () => {
  let s = addRole(blankScenario()); s = addStep(s); s = addStep(s);
  s = toggleAfter(s, 1, "step-1");
  expect(s.steps[1].after).toEqual(["step-1"]);
  s = toggleAfter(s, 1, "step-1");
  expect(s.steps[1].after).toEqual([]);
});

test("renameStepId 联动更新别处 after 引用", () => {
  let s = addRole(blankScenario()); s = addStep(s); s = addStep(s);
  s = toggleAfter(s, 1, "step-1");                // step-2.after=[step-1]
  s = renameStepId(s, 0, "tech");                 // step-1 -> tech
  expect(s.steps[0].id).toBe("tech");
  expect(s.steps[1].after).toEqual(["tech"]);     // 引用同步改名
});

test("updateStep patch 合并", () => {
  let s = addRole(blankScenario()); s = addStep(s);
  s = updateStep(s, 0, { prompt: "hi {{input}}" });
  expect(s.steps[0].prompt).toBe("hi {{input}}");
  expect(s.steps[0].id).toBe("step-1"); // 其它字段保留
});
