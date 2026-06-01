import { TIMEOUT_TEXT } from "../src/lib/orchestration/runScenario";

const PROJECT = "default";

type HubEvent = { event: string; data: any };
type Connect = (onEvent: (e: HubEvent) => void) => () => void; // 返回 disconnect
type PostMessage = (role: string, prompt: string) => Promise<string>; // 返回 msg_id

export interface HubClientOpts {
  baseUrl: string;
  token: string;
  connect?: Connect;       // 默认连真实 hub SSE
  postMessage?: PostMessage; // 默认 POST /v1/messages
  sessionId?: string;
}

function responseText(data: any): string {
  if (data.error != null) return `(错误:${data.error})`;
  const r = data.response;
  if (typeof r === "string") return r;
  if (r && typeof r.text === "string") return r.text;
  return typeof r === "undefined" ? "" : JSON.stringify(r);
}

export class HubClient {
  private waiters = new Map<string, (text: string) => void>();
  private earlyReplies = new Map<string, string>(); // buffered replies before waiter registered
  private disconnect: (() => void) | null = null;
  private opts: Required<Pick<HubClientOpts, "baseUrl" | "token">> & HubClientOpts;
  private sessionId: string;

  constructor(opts: HubClientOpts) {
    this.opts = opts as any;
    this.sessionId = opts.sessionId ?? crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase();
    const connect = opts.connect ?? ((onEvent) => this.connectReal(onEvent));
    this.disconnect = connect((e) => this.onEvent(e));
  }

  private hdrs(): Record<string, string> {
    return { "content-type": "application/json", ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}) };
  }

  // 真实 hub:注册 + 心跳(否则会话被回收,response 事件停止下发)+ 消费 /v1/events SSE
  // (用 fetch 流手动解析,Bun 无内置 EventSource);断流自动重连。
  private connectReal(onEvent: (e: HubEvent) => void): () => void {
    const ctrl = new AbortController();
    let stopped = false;
    let hbTimer: ReturnType<typeof setInterval> | null = null;

    const startHeartbeat = () => {
      if (hbTimer) clearInterval(hbTimer);
      hbTimer = setInterval(() => {
        fetch(`${this.opts.baseUrl}/v1/agents/${this.sessionId}/heartbeat`, {
          method: "POST", headers: this.hdrs(),
          body: JSON.stringify({ project: PROJECT, context_used_pct: 0, queue_depth: 0 }),
        }).catch(() => { /* 漏一拍可恢复 */ });
      }, 8000);
    };

    const loop = async () => {
      while (!stopped) {
        try {
          await fetch(`${this.opts.baseUrl}/v1/agents/register`, {
            method: "POST", headers: this.hdrs(),
            body: JSON.stringify({ project: PROJECT, session_id: this.sessionId, name: "coms-server",
              purpose: "Backend orchestration service", model: "n/a", color: "#7dd3fc", cwd: "server", explicit: true }),
          }).catch(() => {});
          startHeartbeat();
          const res = await fetch(`${this.opts.baseUrl}/v1/events?project=${PROJECT}&session_id=${this.sessionId}`,
            { headers: this.hdrs(), signal: ctrl.signal });
          if (res.body) {
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const frames = buf.split("\n\n");
              buf = frames.pop() ?? "";
              for (const frame of frames) {
                let ev = "message"; let dataStr = "";
                for (const line of frame.split("\n")) {
                  if (line.startsWith("event:")) ev = line.slice(6).trim();
                  else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
                }
                if (!dataStr) continue;
                try { onEvent({ event: ev, data: JSON.parse(dataStr) }); } catch { /* ignore */ }
              }
            }
          }
        } catch { /* aborted or transient — fall through to reconnect */ }
        if (stopped) break;
        await Bun.sleep(2000); // 重连退避
      }
    };
    void loop();
    return () => { stopped = true; if (hbTimer) clearInterval(hbTimer); ctrl.abort(); };
  }

  private async postReal(role: string, prompt: string): Promise<string> {
    const res = await fetch(`${this.opts.baseUrl}/v1/messages`, {
      method: "POST", headers: this.hdrs(),
      body: JSON.stringify({ project: PROJECT, sender_session: this.sessionId, target: role,
        target_session: null, prompt, conversation_id: null, response_schema: null, hops: 0 }),
    });
    const j = await res.json();
    return j.msg_id as string;
  }

  private onEvent(e: HubEvent): void {
    if (e.event !== "response" && e.event !== "error") return;
    const msgId = e.data?.msg_id;
    if (!msgId) return;
    const w = this.waiters.get(msgId);
    if (w) { this.waiters.delete(msgId); w(responseText(e.data)); }
    else { this.earlyReplies.set(msgId, responseText(e.data)); } // arrived before waiter
  }

  async ask(role: string, prompt: string, timeoutMs: number): Promise<string> {
    const post = this.opts.postMessage ?? ((r, p) => this.postReal(r, p));
    const msgId = await post(role, prompt);
    if (!msgId) return "(发送失败:hub 未接受消息)";
    // check if reply already arrived (race: event fired before we registered waiter)
    const early = this.earlyReplies.get(msgId);
    if (early !== undefined) { this.earlyReplies.delete(msgId); return early; }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiters.delete(msgId); resolve(TIMEOUT_TEXT); }, timeoutMs);
      this.waiters.set(msgId, (text) => { clearTimeout(timer); resolve(text); });
    });
  }

  stop(): void { this.disconnect?.(); }
}
