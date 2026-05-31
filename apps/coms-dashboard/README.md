# coms-net · agent control panel

A web dashboard for the `coms-net` agent hub. It shows the live agent pool as an
animated graph, streams every hub event into terminal-style cards, and lets you
send messages to any agent from the browser.

## How it connects

The browser talks only to the Vite dev server (same origin). Vite proxies
`/v1/*` to the coms-net hub and **injects the `Authorization: Bearer` token** —
this is required because the hub has no CORS headers and browser `EventSource`
can't set auth headers itself.

On load the dashboard registers itself as a hidden (`explicit`) observer agent,
keeps a heartbeat alive, and subscribes to the hub's SSE firehose
(`/v1/events`).

The hub URL and token are auto-discovered from the same files the Pi client uses:

```
~/.pi/coms-net/projects/<project>/server.json         # { local_url, port, ... }
~/.pi/coms-net/projects/<project>/server.secret.json   # { token }
```

Override with env vars: `PI_COMS_NET_PROJECT`, `PI_COMS_NET_SERVER_URL`,
`PI_COMS_NET_AUTH_TOKEN`.

## Run

```bash
# 1. Start the hub (from repo root)
just coms-net-server

# 2. Start one or more agents
just coms1 --name alice
just coms2 --name bob

# 3. Start the dashboard
cd apps/coms-dashboard
bun install
bun run dev          # http://localhost:5273
```

## What you can / can't see

| Capability | Works against the hub as-is? |
| --- | --- |
| Live agent pool (join/leave/stale/model/context%) | ✅ broadcast events |
| Dashboard → agent messages + their responses | ✅ |
| Animated graph pulses for panel↔agent traffic | ✅ |
| Per-agent terminal stream cards | ✅ |
| Passively observing **agent ↔ agent** conversations | ✅ with observer firehose |

### Observer firehose (agent ↔ agent visibility)

By default the hub unicasts `prompt`/`response` only to the two participants, so
a passive observer can't see peer-to-peer chatter. Enable the firehose on the
hub to mirror a **sanitized copy** of every peer message to `explicit` observer
streams (like this dashboard):

```bash
PI_COMS_NET_OBSERVER_FIREHOSE=1 just coms-net-server
```

The dashboard registers as an `explicit` observer, so once the firehose is on it
receives `observe` events and animates the graph edge between the two peers and
appends to both of their terminal cards. The sender and target are skipped from
the firehose (they already get the unicast), so there's no duplication. When the
flag is off, peer traffic stays private and nothing is broadcast.

## Stack

React + Vite + TypeScript, [React Flow](https://reactflow.dev) for the graph,
Zustand for state. No backend of its own — the Vite proxy is the only glue.
