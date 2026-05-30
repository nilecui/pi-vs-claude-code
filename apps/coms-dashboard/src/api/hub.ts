import type { AgentCard, RegisterResponse, SendResponse, SseEvent } from "../types";

// All requests go to the same origin; the Vite dev proxy forwards /v1/* to the
// hub and injects the Authorization: Bearer header (see vite.config.ts).
const PROJECT = "default";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface HubHandlers {
  onEvent: (e: SseEvent) => void;
  onStatus: (s: "connecting" | "online" | "offline", detail?: string) => void;
}

/**
 * Drives the dashboard's lifecycle against the hub: it registers itself as an
 * `explicit` (hidden) observer agent, keeps a heartbeat alive, and subscribes to
 * the SSE firehose so the UI sees pool changes in real time.
 */
export class HubClient {
  private sessionId = "";
  private es: EventSource | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private handlers: HubHandlers) {}

  get session(): string {
    return this.sessionId;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.handlers.onStatus("connecting");
    try {
      const reg = await api<RegisterResponse>("/v1/agents/register", {
        method: "POST",
        body: JSON.stringify({
          project: PROJECT,
          session_id: crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase(),
          name: "dashboard",
          purpose: "Web control panel — observes the pool and orchestrates messages.",
          model: "n/a",
          color: "#7dd3fc",
          cwd: "browser",
          explicit: true,
        }),
      });
      this.sessionId = reg.agent.session_id;
      this.startHeartbeat(reg.heartbeat_interval_ms || 10_000);
      this.openStream();
    } catch (e) {
      this.handlers.onStatus("offline", String(e));
      // Retry registration: the hub may not be up yet.
      if (!this.stopped) setTimeout(() => this.start(), 3000);
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      api(`/v1/agents/${this.sessionId}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ project: PROJECT, context_used_pct: 0, queue_depth: 0 }),
      }).catch(() => {
        /* a missed beat is recoverable; the SSE reconnect will surface real failures */
      });
    }, Math.max(3000, intervalMs));
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private openStream(): void {
    if (this.es) this.es.close();
    const url = `/v1/events?project=${encodeURIComponent(PROJECT)}&session_id=${encodeURIComponent(
      this.sessionId,
    )}`;
    const es = new EventSource(url);
    this.es = es;

    const named: SseEvent["event"][] = [
      "hello",
      "pool_snapshot",
      "agent_joined",
      "agent_updated",
      "agent_stale",
      "agent_left",
      "prompt",
      "response",
      "message_status",
    ];
    for (const name of named) {
      es.addEventListener(name, (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          this.handlers.onEvent({ event: name, data } as SseEvent);
        } catch {
          /* ignore malformed frame */
        }
      });
    }

    es.onopen = () => this.handlers.onStatus("online");
    es.onerror = () => {
      // EventSource auto-reconnects; if the session was reaped we re-register.
      this.handlers.onStatus("connecting", "stream interrupted");
      if (es.readyState === EventSource.CLOSED && !this.stopped) {
        setTimeout(() => this.start(), 2000);
      }
    };
  }

  async listAgents(): Promise<AgentCard[]> {
    const r = await api<{ ok: true; agents: AgentCard[] }>(
      `/v1/agents?project=${encodeURIComponent(PROJECT)}`,
    );
    return r.agents ?? [];
  }

  async send(target: string, prompt: string): Promise<SendResponse> {
    return api<SendResponse>("/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        project: PROJECT,
        sender_session: this.sessionId,
        target,
        target_session: null,
        prompt,
        conversation_id: null,
        response_schema: null,
        hops: 0,
      }),
    });
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    if (this.es) this.es.close();
    this.es = null;
    if (this.sessionId) {
      // Best-effort graceful deregister.
      fetch(`/v1/agents/${this.sessionId}?project=${PROJECT}`, { method: "DELETE" }).catch(
        () => {},
      );
    }
  }
}
