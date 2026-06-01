export interface RunEvent { type: "step" | "status" | "result" | "done" | "error"; [k: string]: unknown; }
type Sub = (e: RunEvent) => void;

export class RunHub {
  private subs = new Map<string, Set<Sub>>();
  subscribe(runId: string, fn: Sub): () => void {
    let set = this.subs.get(runId);
    if (!set) { set = new Set(); this.subs.set(runId, set); }
    set.add(fn);
    return () => { set!.delete(fn); if (set!.size === 0) this.subs.delete(runId); };
  }
  broadcast(runId: string, e: RunEvent): void {
    const set = this.subs.get(runId);
    if (!set) return;
    for (const fn of set) { try { fn(e); } catch { /* ignore one bad subscriber */ } }
  }
}
