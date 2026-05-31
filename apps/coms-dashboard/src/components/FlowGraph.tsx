import { useEffect, useRef, useState } from "react";
import { Graph, NodeEvent, type GraphData, type LayoutOptions } from "@antv/g6";
import { DASHBOARD_ID, edgeKey, useStore } from "../store";
import { LAYOUT_LABEL } from "../lib/labels";

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
  tree: { type: "antv-dagre", rankdir: "TB", nodesep: 30, ranksep: 80 },
};
type LayoutKey = keyof typeof LAYOUTS;

const asLayout = (l: Record<string, unknown>) => l as unknown as LayoutOptions;

type Agents = ReturnType<typeof useStore.getState>["agents"];
type EdgeCounts = ReturnType<typeof useStore.getState>["edgeCounts"];

// Base dataset only: circular avatar nodes (panel + agents) and the faint resting
// curved `base-<id>` panel→agent edges (carrying the live message count). Transient
// pulse edges are reconciled incrementally in a separate effect so a full setData()
// never tries to diff/remove them — which makes G6 5.1.1 throw "Edge not found".
function buildBaseData(agents: Agents, counts: EdgeCounts): GraphData {
  const list = Object.values(agents).filter((a) => !a.explicit);
  const nodes: NonNullable<GraphData["nodes"]> = [
    {
      id: DASHBOARD_ID,
      data: { name: "控制面板", color: "#3b82f6", status: "online", dashboard: true },
    },
  ];
  for (const a of list) {
    nodes.push({
      id: a.session_id,
      data: { name: a.name, color: a.color, status: a.status },
    });
  }
  const edges: NonNullable<GraphData["edges"]> = list.map((a) => {
    const count = counts[edgeKey(DASHBOARD_ID, a.session_id)] ?? 0;
    return {
      id: `base-${a.session_id}`,
      source: DASHBOARD_ID,
      target: a.session_id,
      data: { color: "#c7d2fe", count },
    };
  });
  return { nodes, edges };
}

export function FlowGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const agents = useStore((s) => s.agents);
  const flows = useStore((s) => s.flows);
  const edgeCounts = useStore((s) => s.edgeCounts);
  const select = useStore((s) => s.select);
  const [layout, setLayout] = useState<LayoutKey>("force");
  // Ids of pulse edges currently drawn, for incremental add/remove reconciliation.
  const drawn = useRef<Set<string>>(new Set());

  // Create once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      autoFit: "center",
      animation: true,
      data: buildBaseData(useStore.getState().agents, useStore.getState().edgeCounts),
      layout: asLayout(LAYOUTS.force),
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
          // Small status dot at bottom-right (color reflects online/stale/offline).
          badge: true,
          badges: ((d: any) => [
            {
              text: "",
              placement: "right-bottom",
              backgroundFill: STATUS_DOT[d.data?.status ?? "online"] ?? "#10b981",
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
          lineWidth: (d: any) => (d.data?.pulse ? 3 : 2),
          opacity: (d: any) => (d.data?.pulse ? 1 : 0.9),
          endArrow: (d: any) => !!d.data?.pulse,
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
    const rendered = graph.render().catch(() => {});
    graphRef.current = graph;

    // ── Animation loop ────────────────────────────────────────────────────────
    // One shared rAF, throttled to ~20fps, that (a) advances lineDashOffset on
    // every edge (flowing "ants" on base edges + comet on pulse edges) and
    // (b) breathes the halo opacity on online nodes. Guarded against a destroyed
    // graph and cancelled on cleanup so it can never log to the console.
    let raf = 0;
    let last = 0;
    let dashOffset = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return; // ~20fps
      last = t;
      const g = graphRef.current;
      if (!g || g.destroyed) return;
      try {
        dashOffset = (dashOffset + 1.2) % 1000;
        const breath = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(t / 1000)); // ~2s ease loop
        const edgeUpdates = g.getEdgeData().map((e: any) => ({
          id: e.id,
          style: { lineDashOffset: -dashOffset },
        }));
        const nodeUpdates = g
          .getNodeData()
          .filter((n: any) => n.data?.status === "online")
          .map((n: any) => ({ id: n.id, style: { haloStrokeOpacity: breath } }));
        if (edgeUpdates.length) g.updateEdgeData(edgeUpdates);
        if (nodeUpdates.length) g.updateNodeData(nodeUpdates);
        g.draw().catch(() => {});
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

  // Rebuild base nodes/edges when the agent pool OR message counts change.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      g.setData(buildBaseData(agents, edgeCounts));
      // Base data no longer carries pulse edges; clear our reconciliation set so
      // the pulse effect re-adds any still-active flows on the fresh dataset.
      drawn.current.clear();
      g.render().catch(() => {});
    } catch {}
  }, [agents, edgeCounts]);

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
      g.draw().catch(() => {});
    } catch {}
  }, [flows, agents]);

  // Switch layout preset.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    g.setLayout(asLayout(LAYOUTS[layout]));
    g.render().catch(() => {});
  }, [layout]);

  return (
    <div className="graph-wrap">
      <div className="graph-canvas" ref={containerRef} />
      <div className="layout-switch">
        <span className="section-label">视角</span>
        {(Object.keys(LAYOUTS) as LayoutKey[]).map((k) => (
          <button key={k} className={`chip ${layout === k ? "on" : ""}`} onClick={() => setLayout(k)}>
            {LAYOUT_LABEL[k] ?? k}
          </button>
        ))}
      </div>
    </div>
  );
}
