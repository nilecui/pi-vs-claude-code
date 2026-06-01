import { expect, test } from "bun:test";
import { RunHub } from "./runHub";

test("broadcast 推送给所有订阅者,unsubscribe 后不再收", () => {
  const hub = new RunHub();
  const a: string[] = []; const b: string[] = [];
  const unsubA = hub.subscribe("r1", (e) => a.push(e.type));
  hub.subscribe("r1", (e) => b.push(e.type));
  hub.broadcast("r1", { type: "step" });
  unsubA();
  hub.broadcast("r1", { type: "done" });
  expect(a).toEqual(["step"]);
  expect(b).toEqual(["step", "done"]);
});

test("不同 run 互不串", () => {
  const hub = new RunHub();
  const r1: string[] = [];
  hub.subscribe("r1", (e) => r1.push(e.type));
  hub.broadcast("r2", { type: "step" });
  expect(r1).toEqual([]);
});
