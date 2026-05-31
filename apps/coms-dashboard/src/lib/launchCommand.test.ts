import { expect, test } from "bun:test";
import { launchCommand } from "./launchCommand";

test("name only → just coms", () => {
  expect(launchCommand({ name: "alice" })).toBe("just coms --name alice");
});

test("provider + model passthrough", () => {
  expect(launchCommand({ name: "alice", provider: "openai", model: "gpt-5.5" }))
    .toBe('just coms --name alice --provider openai --model gpt-5.5');
});

test("purpose with spaces is quoted", () => {
  expect(launchCommand({ name: "bob", purpose: "Prod gatekeeper" }))
    .toBe('just coms --name bob --purpose "Prod gatekeeper"');
});

test("color flag", () => {
  expect(launchCommand({ name: "c", color: "#10b981" }))
    .toBe('just coms --name c --color "#10b981"');
});

test("default project omitted, custom project included", () => {
  expect(launchCommand({ name: "a", project: "default" })).toBe("just coms --name a");
  expect(launchCommand({ name: "a", project: "team-x" }))
    .toBe("just coms --name a --project team-x");
});

test("explicit is a valueless flag", () => {
  expect(launchCommand({ name: "a", explicit: true }))
    .toBe("just coms --name a --explicit");
});

test("cwd prefixes a cd", () => {
  expect(launchCommand({ name: "a", cwd: "/tmp/work" }))
    .toBe("cd /tmp/work && just coms --name a");
});

test("bare form emits pi -e with extension paths", () => {
  expect(launchCommand({ name: "a", bare: true }))
    .toBe("pi -e extensions/coms-net.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts --name a");
});

test("embedded double-quote in purpose is escaped", () => {
  expect(launchCommand({ name: "a", purpose: 'say "hi"' }))
    .toBe('just coms --name a --purpose "say \\"hi\\""');
});
