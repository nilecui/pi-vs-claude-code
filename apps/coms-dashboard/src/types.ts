// Mirrors the shared types in scripts/coms-net-server.ts so the dashboard speaks
// the hub's protocol exactly.

export type AgentStatus = "online" | "stale" | "offline";

export type MessageStatus =
  | "queued"
  | "delivered"
  | "complete"
  | "error"
  | "timeout";

export interface AgentCard {
  session_id: string;
  name: string;
  purpose: string;
  model: string;
  provider?: string;
  color: string;
  cwd: string;
  project: string;
  explicit: boolean;
  started_at: string;
  context_used_pct: number;
  queue_depth: number;
  status: AgentStatus;
}

export interface RegisterResponse {
  ok: true;
  agent: AgentCard;
  heartbeat_interval_ms: number;
  sse_url: string;
}

export interface SendResponse {
  ok: true;
  msg_id: string;
  status: MessageStatus;
  target_session: string;
}

// ── SSE events emitted by the hub on /v1/events ──────────────────────────────
export type SseEvent =
  | { event: "hello"; data: { server_time: string; server_id: string } }
  | { event: "pool_snapshot"; data: { agents: AgentCard[] } }
  | { event: "agent_joined"; data: { agent: AgentCard } }
  | { event: "agent_updated"; data: { agent: AgentCard } }
  | {
      event: "agent_stale";
      data: { session_id: string; name: string; last_seen_at: string };
    }
  | {
      event: "agent_left";
      data: { session_id: string; name: string; reason: string };
    }
  | {
      event: "prompt";
      data: {
        msg_id: string;
        sender: string;
        sender_session?: string;
        prompt: string;
        hops?: number;
      };
    }
  | {
      event: "response";
      data: {
        msg_id: string;
        responder: string;
        response: unknown;
        error: string | null;
        status: MessageStatus;
      };
    }
  | { event: "message_status"; data: { msg_id: string; status: MessageStatus } };

// ── Local model of an observed conversation line, rendered in terminal cards ──
export interface StreamLine {
  id: string;
  ts: number;
  kind: "prompt" | "response" | "status" | "error" | "system";
  from: string;
  to?: string;
  text: string;
  msg_id?: string;
}
