import { useEffect, useRef, useState } from "react";
import { EdgeEvent, Graph, NodeEvent, type GraphData, type LayoutOptions } from "@antv/g6";
import { Renderer as CanvasRenderer } from "@antv/g-canvas";
import { DASHBOARD_ID, edgeKey, useStore } from "../store";
import { LAYOUT_LABEL } from "../lib/labels";
import { ConversationDialog } from "./ConversationDialog";

const FLOW_COLOR: Record<string, string> = {
  prompt: "#3b82f6",
  response: "#10b981",
  error: "#ef4444",
};

// Status → online dot color (green / amber / zinc).
const STATUS_DOT: Record<string, string> = {
  online: "#10b981",
  stale: "#f59e0b",
  offline: "#71717a",
};

// 4-state display dot: stopped (stale/offline) zinc, working (online + queued)
// blue, idle (online + empty queue) green.
const DOT_STOPPED = "#71717a";
const DOT_WORKING = "#3b82f6";
const DOT_IDLE = "#10b981";
const dotColorFor = (status: string, queueDepth: number) =>
  status === "stale" || status === "offline"
    ? DOT_STOPPED
    : queueDepth > 0
      ? DOT_WORKING
      : DOT_IDLE;

const statusOpacity = (status?: string) =>
  status === "offline" ? 0.4 : status === "stale" ? 0.65 : 1;

// Centered lucide "bot" glyph (dark stroke) as a data-URI, drawn inside the avatar.
const BOT_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%230f172a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 8V4H8'/%3E%3Crect width='16' height='12' x='4' y='8' rx='2'/%3E%3Cpath d='M2 14h2M20 14h2M15 13v2M9 13v2'/%3E%3C/svg%3E";

// Layout presets. Type strings verified against @antv/g6 5.1.1 built-in registry:
// `d3-force`, `radial`, `antv-dagre` are all registered. Stored loosely and cast
// to LayoutOptions at use sites since the built-in union is a strict discriminated type.
const LAYOUTS: Record<string, Record<string, unknown>> = {
  force: { type: "d3-force", collide: { radius: 60 } },
  radial: { type: "radial", unitRadius: 170, linkDistance: 170 },
  dagre: { type: "antv-dagre", rankdir: "LR", nodesep: 24, ranksep: 120 },
  tree: { type: "antv-dagre", rankdir: "TB", nodesep: 24, ranksep: 60 },
};
type LayoutKey = keyof typeof LAYOUTS;

const asLayout = (l: Record<string, unknown>) => l as unknown as LayoutOptions;

type Agents = ReturnType<typeof useStore.getState>["agents"];
type EdgeCounts = ReturnType<typeof useStore.getState>["edgeCounts"];

// Resolve a node/session id to a human name for the conversation dialog, which
// filters StreamLines by `from`/`to` names ("dashboard" for the panel node).
const nameOf = (sessionId: string): string =>
  sessionId === DASHBOARD_ID
    ? "dashboard"
    : useStore.getState().agents[sessionId]?.name ?? sessionId;

// Base dataset: circular avatar nodes (panel + agents) plus a faint curved
// `base-<sortedPairKey>` edge for the panel→agent structure AND for every pair
// that has exchanged messages (incl. peer↔peer), each carrying its live count.
// Transient pulse edges are reconciled incrementally in a separate effect so a
// full setData() never tries to diff/remove them — which would make G6 5.1.1
// throw "Edge not found".
function buildBaseData(agents: Agents, counts: EdgeCounts): GraphData {
  // Hide observers from the graph: explicit registrations AND the panel's own
  // hub identities ("dashboard", "dashboard2", … — one per browser/reload). The
  // synthetic 控制面板 node already represents the panel; a real "dashboard" node
  // would be a confusing duplicate.
  const list = Object.values(agents).filter((a) => !a.explicit && !/^dashboard\d*$/i.test(a.name));
  const nodeIds = new Set<string>([DASHBOARD_ID, ...list.map((a) => a.session_id)]);
  const nodes: NonNullable<GraphData["nodes"]> = [
    {
      id: DASHBOARD_ID,
      data: { name: "控制面板", color: "#3b82f6", status: "online", dashboard: true },
    },
  ];
  for (const a of list) {
    nodes.push({
      id: a.session_id,
      data: {
        name: a.name,
        color: a.color,
        status: a.status,
        dotColor: dotColorFor(a.status, a.queue_depth),
      },
    });
  }

  const edgeMap = new Map<string, { id: string; source: string; target: string; count: number }>();
  const add = (source: string, target: string) => {
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return;
    const key = edgeKey(source, target);
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { id: `base-${key}`, source, target, count: counts[key] ?? 0 });
    } else {
      edgeMap.get(key)!.count = counts[key] ?? edgeMap.get(key)!.count;
    }
  };
  for (const a of list) add(DASHBOARD_ID, a.session_id); // structural panel↔agent edges
  for (const k of Object.keys(counts)) {
    // counted pairs (incl. peer↔peer); only render if both endpoints still exist
    const [s, t] = k.split("::");
    add(s, t);
  }

  const edges: NonNullable<GraphData["edges"]> = [...edgeMap.values()].map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: { color: "#c7d2fe", count: e.count },
  }));
  return { nodes, edges };
}

export function FlowGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const agents = useStore((s) => s.agents);
  const flows = useStore((s) => s.flows);
  const edgeCounts = useStore((s) => s.edgeCounts);
  const select = useStore((s) => s.select);
  const replay = useStore((s) => s.replay);
  const [layout, setLayout] = useState<LayoutKey>("tree");
  // Open conversation dialog for a clicked base edge: [nameA, nameB].
  const [convo, setConvo] = useState<[string, string] | null>(null);
  // Ids of pulse edges currently drawn, for incremental add/remove reconciliation.
  const drawn = useRef<Set<string>>(new Set());
  // Render lock: true while a (re)layout render() is in flight, so the rAF draw
  // loop pauses and the render gets exclusive access (no overlapping draws).
  const rendering = useRef(false);

  // Create once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      // Force full-canvas repaint on every draw() by disabling dirty-rectangle
      // rendering. Inside the right-side drawer (a fixed, backdrop-filtered,
      // transform-animated stacking context) G6's dirty-rectangle math computes
      // the wrong invalidation region, so the rAF loop's updateEdgeData()+draw()
      // micro-updates (flowing dash + halo breathing) reconcile into the data but
      // never actually repaint — the graph looked frozen. Full repaint sidesteps
      // that; the graph is small so the cost at ~20fps is negligible. (Only render()
      // worked before because it always does a full repaint.)
      renderer: () => new CanvasRenderer({ enableDirtyRectangleRendering: false }),
      autoFit: "center",
      // Margin kept around content when auto-fitting / fitView (5.1.1 FitViewOptions
      // has no padding key — padding lives at the viewport/graph level).
      padding: 48,
      // Disable G6's built-in element/layout transition animations. Our rAF loop
      // drives ALL the motion (flowing dash + halo breathing) via plain style
      // writes + draw, so data updates (heartbeats, pulses, add/remove) apply
      // instantly and never schedule a G6 transition — which under frequent
      // agent_updated heartbeats raced the rAF micro-updates and threw inside
      // G6's animation merge (reading 'onUpdate' of undefined).
      animation: false,
      data: buildBaseData(useStore.getState().agents, useStore.getState().edgeCounts),
      layout: asLayout(LAYOUTS.tree),
      node: {
        type: "circle",
        style: {
          size: 60,
          fill: "#ffffff",
          stroke: (d: any) => d.data?.color ?? "#3b82f6",
          lineWidth: 2,
          opacity: (d: any) => statusOpacity(d.data?.status),
          // Soft colored glow ring (breathing animated in the rAF loop below).
          halo: true,
          haloStroke: (d: any) => d.data?.color ?? "#3b82f6",
          haloStrokeOpacity: 0.22,
          haloLineWidth: 10,
          // Centered bot avatar.
          icon: true,
          iconSrc: BOT_ICON,
          iconWidth: 26,
          iconHeight: 26,
          // Small status dot at bottom-right. Agents use the 4-state dotColor
          // (idle/working/stopped); the dashboard node falls back to its status.
          badge: true,
          badges: ((d: any) => [
            {
              text: "",
              placement: "right-bottom",
              backgroundFill: d.data?.dotColor ?? STATUS_DOT[d.data?.status ?? "online"] ?? "#10b981",
              backgroundRadius: 6,
              backgroundWidth: 12,
              backgroundHeight: 12,
              backgroundStroke: "#ffffff",
              backgroundLineWidth: 2,
            },
          ]) as any,
          // Name in a white rounded pill below the avatar.
          labelText: (d: any) => d.data?.name ?? d.id,
          labelPlacement: "bottom",
          labelFill: "#0f172a",
          labelFontSize: 11,
          labelFontWeight: 600,
          labelBackground: true,
          labelBackgroundFill: "#ffffff",
          labelBackgroundRadius: 8,
          labelPadding: [3, 8] as any,
          labelBackgroundStroke: "#e2e8f0",
          labelBackgroundLineWidth: 1,
        },
      },
      edge: {
        type: "cubic",
        style: {
          stroke: (d: any) => d.data?.color ?? "#c7d2fe",
          lineWidth: (d: any) => (d.data?.pulse ? 2 : 1),
          opacity: (d: any) => (d.data?.pulse ? 1 : 0.9),
          // Directed: small arrowhead on every edge (base + pulse).
          endArrow: true,
          endArrowSize: 6,
          // Flowing dashed segments: short comet on pulses, longer "ants" on base.
          lineDash: (d: any) => (d.data?.pulse ? [4, 14] : [6, 6]),
          lineDashOffset: 0,
          // Numeric message-count badge at the curve midpoint (only when > 0).
          labelText: (d: any) => (d.data?.count > 0 ? String(d.data.count) : undefined),
          labelPlacement: "center",
          labelFill: "#6d28d9",
          labelFontSize: 10,
          labelFontWeight: 700,
          labelBackground: true,
          labelBackgroundFill: "#ede9fe",
          labelBackgroundRadius: 8,
          labelPadding: [2, 6] as any,
        },
      },
      behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    });
    graph.on(NodeEvent.CLICK, (evt: any) => {
      const id = evt.target?.id;
      if (id && id !== DASHBOARD_ID) select(id);
    });
    // Click a base edge (or its count badge) → open the conversation dialog.
    graph.on(EdgeEvent.CLICK, (evt: any) => {
      const g = graphRef.current;
      if (!g || g.destroyed) return;
      const id: string | undefined = evt.target?.id;
      if (!id || !id.startsWith("base-")) return; // ignore transient flow- pulses
      try {
        const e: any = g.getEdgeData(id);
        if (!e) return;
        setConvo([nameOf(e.source), nameOf(e.target)]);
      } catch {}
    });
    rendering.current = true;
    const rendered = graph
      .render()
      .then(() => graph.fitView({ when: "always" }))
      .catch(() => {})
      .finally(() => {
        rendering.current = false;
      });
    graphRef.current = graph;

    // ── Animation loop ────────────────────────────────────────────────────────
    // One shared rAF, throttled to ~20fps, that (a) advances lineDashOffset on
    // every edge (flowing "ants" on base edges + comet on pulse edges) and
    // (b) breathes the halo opacity on online nodes. Guarded against a destroyed
    // graph and cancelled on cleanup so it can never log to the console.
    let raf = 0;
    let last = 0;
    let offset = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return; // ~20fps
      last = t;
      const g = graphRef.current;
      if (!g || g.destroyed || rendering.current) return;
      try {
        offset = (offset + 1.2) % 1000;
        const halo = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(offset * 0.15));
        // draw() reconciles STRUCTURAL changes (pulse edges added/removed by the
        // flows effect) into the scene graph. It does NOT drive the per-frame
        // motion: inside the drawer's stacking context updateEdgeData()+draw()
        // reconciles data but never repaints, so the graph looked frozen. Instead,
        // once the shapes exist, write the animated styles straight onto the
        // rendered shapes (setAttribute updates their parsedStyle reactively) and
        // force a full canvas repaint (dirty-rectangle rendering is disabled in the
        // Graph config, otherwise the computed dirty region here is empty).
        g.draw()
          .then(() => {
            try {
              const map: any = (g as any).context?.element?.elementMap;
              if (!map) return;
              for (const e of g.getEdgeData()) {
                const key = map[e.id as string]?.shapeMap?.key;
                key?.setAttribute?.("lineDashOffset", -offset * ((e.id as string)?.startsWith("flow-") ? 2 : 1));
              }
              for (const n of g.getNodeData()) {
                if ((n.data as any)?.status !== "online") continue;
                map[n.id as string]?.shapeMap?.halo?.setAttribute?.("strokeOpacity", halo);
              }
              (g as any).context?.canvas?.getRoot?.()?.ownerDocument?.defaultView?.render();
            } catch {}
          })
          .catch(() => {});
      } catch {}
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      graphRef.current = null;
      // Defer destroy until the in-flight render settles, so StrictMode's
      // mount→cleanup→mount cycle never destroys a graph mid-render.
      void rendered.finally(() => graph.destroy());
    };
  }, [select]);

  // Rebuild base nodes/edges + relayout ONLY when the agent pool changes (rare).
  // It seeds initial labels from current counts but does NOT re-run on count
  // changes — counts update incrementally below, so setData/render never races
  // the rAF draw loop. The rAF loop is the only repeated renderer.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      g.setData(buildBaseData(agents, useStore.getState().edgeCounts));
      // Base data no longer carries pulse edges; clear our reconciliation set so
      // the pulse effect re-adds any still-active flows on the fresh dataset.
      drawn.current.clear();
      // Lock the rAF loop out while this relayout render draws, so adding OR
      // removing nodes never overlaps the continuous draw loop.
      rendering.current = true;
      g.render()
        .then(() => g.fitView({ when: "always" }))
        .catch(() => {})
        .finally(() => {
          rendering.current = false;
        });
    } catch {}
  }, [agents]);

  // Update only the message-count labels on base edges when counts change.
  // No setData / render / draw — the rAF loop renders next frame.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      const updates = g
        .getEdgeData()
        .filter((e: any) => e.id?.startsWith("base-"))
        .map((e: any) => {
          const count = edgeCounts[edgeKey(e.source, e.target)] ?? 0;
          return { id: e.id, style: { labelText: count > 0 ? String(count) : undefined } };
        });
      if (updates.length) g.updateEdgeData(updates);
    } catch {}
  }, [edgeCounts, agents]);

  // Reconcile transient pulse edges incrementally (add new, remove gone) so the
  // demo's rapid add/clear of flows never triggers a full-dataset diff.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      const nodeIds = new Set(g.getNodeData().map((n: any) => n.id));
      const want = new Map<string, { source: string; target: string; color: string }>();
      for (const f of flows) {
        if (!nodeIds.has(f.from) || !nodeIds.has(f.to)) continue;
        want.set(`flow-${f.id}`, {
          source: f.from,
          target: f.to,
          color: FLOW_COLOR[f.kind] ?? "#3b82f6",
        });
      }
      // Add edges that are wanted but not yet drawn.
      for (const [id, e] of want) {
        if (drawn.current.has(id)) continue;
        g.addEdgeData([{ id, source: e.source, target: e.target, data: { color: e.color, pulse: true } }]);
        drawn.current.add(id);
      }
      // Remove edges we previously drew that are no longer wanted.
      for (const id of [...drawn.current]) {
        if (!want.has(id)) {
          try {
            g.removeEdgeData([id]);
          } catch {}
          drawn.current.delete(id);
        }
      }
      // No draw() here — the rAF loop renders the added/removed pulse edges next frame.
    } catch {}
  }, [flows, agents]);

  // Switch layout preset.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    g.setLayout(asLayout(LAYOUTS[layout]));
    rendering.current = true;
    g.render()
      .then(() => g.fitView({ when: "always" }))
      .catch(() => {})
      .finally(() => {
        rendering.current = false;
      });
  }, [layout]);

  // Viewport controls (zoom/fit). These don't relayout data, but still guard
  // against a destroyed instance and swallow any rejection so the console stays clean.
  const zoomBy = (ratio: number) => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      void g.zoomBy(ratio).catch(() => {});
    } catch {}
  };
  const fitView = () => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      void g.fitView({ when: "always" }).catch(() => {});
    } catch {}
  };

  return (
    <div className="graph-wrap">
      <div className="graph-canvas" ref={containerRef} />
      <div className="graph-controls">
        <button title="回放消息流" onClick={() => replay()}>⟲</button>
        <button title="放大" onClick={() => zoomBy(1.2)}>＋</button>
        <button title="缩小" onClick={() => zoomBy(1 / 1.2)}>－</button>
        <button title="居中适配" onClick={fitView}>⤢</button>
      </div>
      <div className="graph-legend">
        <span><i style={{ background: "#10b981" }} />空闲</span>
        <span><i style={{ background: "#3b82f6" }} />工作中</span>
        <span><i style={{ background: "#71717a" }} />已停止</span>
        <span><i className="ln" style={{ background: "#c7d2fe" }} />活跃连接</span>
      </div>
      <div className="layout-switch">
        <span className="section-label">视角</span>
        {(Object.keys(LAYOUTS) as LayoutKey[]).map((k) => (
          <button key={k} className={`chip ${layout === k ? "on" : ""}`} onClick={() => setLayout(k)}>
            {LAYOUT_LABEL[k] ?? k}
          </button>
        ))}
      </div>
      {convo && <ConversationDialog pair={convo} onClose={() => setConvo(null)} />}
    </div>
  );
}
