#!/usr/bin/env bun
/**
 * End-to-end test for the coms-net observer firehose.
 *
 * Self-contained: it boots its own hub on an isolated project + port, exercises
 * the HTTP/SSE protocol directly (no `pi` needed), and asserts behaviour both
 * with the firehose ON and OFF. Run with:
 *
 *     bun scripts/coms-net-firehose.test.ts
 *     just test-firehose
 *
 * Exit code 0 = all assertions passed, 1 = failure.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 52971;
const PROJECT = `firehose-test-${process.pid}`;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = join(import.meta.dir, "coms-net-server.ts");
const PROJECT_DIR = join(homedir(), ".pi", "coms-net", "projects", PROJECT);

const sid = (n: string) => (n.toUpperCase() + "0".repeat(26)).slice(0, 26);

function bootHub(firehose: boolean) {
  const child = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      PI_COMS_NET_PORT: String(PORT),
      PI_COMS_NET_PROJECT: PROJECT,
      PI_COMS_NET_LOG_QUIET: "1",
      ...(firehose ? { PI_COMS_NET_OBSERVER_FIREHOSE: "1" } : {}),
    },
    stdio: "ignore",
  });
  return child;
}

function readToken(): string {
  const f = join(homedir(), ".pi", "coms-net", "projects", PROJECT, "server.secret.json");
  return JSON.parse(readFileSync(f, "utf8")).token as string;
}

async function waitForHealth(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("hub did not become healthy in time");
    await new Promise((r) => setTimeout(r, 150));
  }
}

function headers(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function register(token: string, name: string, explicit: boolean): Promise<string> {
  const r = await fetch(`${BASE}/v1/agents/register`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      project: PROJECT, session_id: sid(name), name,
      purpose: "test", model: "test", color: "#ffffff", cwd: "/tmp", explicit,
    }),
  });
  if (!r.ok) throw new Error(`register ${name}: ${r.status} ${await r.text()}`);
  return (await r.json()).agent.session_id as string;
}

/** Opens an SSE stream and collects frames of the named event until closed. */
function collectStream(token: string, session_id: string, event: string) {
  const frames: any[] = [];
  const ac = new AbortController();
  const ready = (async () => {
    const res = await fetch(
      `${BASE}/v1/events?project=${PROJECT}&session_id=${session_id}`,
      { headers: headers(token), signal: ac.signal },
    );
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const f of parts) {
            const ev = /event: (\w+)/.exec(f)?.[1];
            const data = /data: (.*)/.exec(f)?.[1];
            if (ev === event && data) frames.push(JSON.parse(data));
          }
        }
      } catch {
        /* aborted */
      }
    })();
  })();
  return { frames, close: () => ac.abort(), ready };
}

async function exchange(token: string, alice: string, bob: string) {
  const send = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      project: PROJECT, sender_session: alice, target: "bob", target_session: bob,
      prompt: "hey bob, what model are you?", conversation_id: null,
      response_schema: null, hops: 0,
    }),
  });
  const { msg_id } = await send.json();
  await fetch(`${BASE}/v1/messages/${msg_id}/response`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      project: PROJECT, responder_session: bob, response: "I am test-model", error: null,
    }),
  });
}

let failures = 0;
function check(cond: boolean, label: string) {
  console.log(`${cond ? "  ✅" : "  ❌"} ${label}`);
  if (!cond) failures++;
}

async function scenario(firehose: boolean) {
  console.log(`\n▸ firehose ${firehose ? "ON" : "OFF"}`);
  const hub = bootHub(firehose);
  try {
    await waitForHealth();
    const token = readToken();

    const dash = await register(token, "dashboard", true);
    const alice = await register(token, "alice", false);
    const bob = await register(token, "bob", false);

    // Observer (dashboard) + bob both watch their `observe` channel.
    const obs = collectStream(token, dash, "observe");
    const bobObs = collectStream(token, bob, "observe");
    await Promise.all([obs.ready, bobObs.ready]);
    await new Promise((r) => setTimeout(r, 300));

    await exchange(token, alice, bob);
    await new Promise((r) => setTimeout(r, 400));
    obs.close();
    bobObs.close();

    const prompts = obs.frames.filter((o) => o.phase === "prompt");
    const responses = obs.frames.filter((o) => o.phase === "response");

    if (firehose) {
      check(prompts.length === 1, "observer received exactly one prompt frame");
      check(responses.length === 1, "observer received exactly one response frame");
      check(prompts[0]?.sender?.name === "alice" && prompts[0]?.target?.name === "bob", "prompt frame carries alice→bob");
      check(prompts[0]?.prompt === "hey bob, what model are you?", "prompt text preserved");
      check(responses[0]?.response === "I am test-model", "response text preserved");
      check(bobObs.frames.length === 0, "target (bob) is NOT echoed its own message via observe");
    } else {
      check(obs.frames.length === 0, "observer receives nothing when firehose is off");
    }
  } finally {
    hub.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  // Refuse to clobber a real hub already on the port.
  const serverJson = join(homedir(), ".pi", "coms-net", "projects", PROJECT, "server.json");
  if (existsSync(serverJson)) {
    console.error(`test project dir already exists: ${serverJson} — aborting to avoid clobber`);
    process.exit(1);
  }

  try {
    await scenario(true);
    await scenario(false);
  } finally {
    // Remove the isolated test project dir (the hub only unlinks its own state files).
    rmSync(PROJECT_DIR, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\n✅ firehose test passed" : `\n❌ ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
