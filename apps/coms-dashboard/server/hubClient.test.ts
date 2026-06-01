import { expect, test } from "bun:test";
import { HubClient } from "./hubClient";

function makeClient() {
  const emit: { fn: ((e: any) => void) | null } = { fn: null };
  const sent: { role: string; prompt: string; msgId: string }[] = [];
  let counter = 0;
  const client = new HubClient({
    baseUrl: "http://test",
    token: "t",
    connect: (onEvent) => { emit.fn = onEvent; return () => {}; },
    postMessage: async (role, _prompt) => { const msgId = `m${++counter}`; sent.push({ role, prompt: _prompt, msgId }); return msgId; },
  });
  return { client, emit, sent };
}

test("ask 按 msg_id 关联回复", async () => {
  const { client, emit, sent } = makeClient();
  const p = client.ask("worker", "do it", 1000);
  // 模拟 hub 回了一个无关 msg_id,再回正确的
  emit.fn!({ event: "response", data: { sender: { name: "worker" }, msg_id: "other", response: "nope" } });
  emit.fn!({ event: "response", data: { sender: { name: "worker" }, msg_id: sent[0].msgId, response: "yes" } });
  expect(await p).toBe("yes");
});

test("ask 超时返回 TIMEOUT_TEXT", async () => {
  const { client } = makeClient();
  const r = await client.ask("worker", "x", 30);
  expect(r).toBe("(超时:未收到回复)");
});

test("error 事件也能 resolve(按 msg_id)", async () => {
  const { client, emit, sent } = makeClient();
  const p = client.ask("worker", "x", 1000);
  emit.fn!({ event: "response", data: { sender: { name: "worker" }, msg_id: sent[0].msgId, error: "boom" } });
  expect(await p).toContain("boom");
});
