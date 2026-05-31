import { useEffect, useRef, useState } from "react";
import { Graph, NodeEvent, type GraphData, type LayoutOptions } from "@antv/g6";
import { DASHBOARD_ID, useStore } from "../store";
import { LAYOUT_LABEL } from "../lib/labels";

const FLOW_COLOR: Record<string, string> = {
  prompt: "#3b82f6",
  response: "#10b981",
  error: "#ef4444",
};

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

// Base dataset only: nodes (panel + agents) and the faint resting `base-<id>`
// panel→agent edges. Transient pulse edges are reconciled incrementally in a
// separate effect so a full setData() never tries to diff/remove them — which
// makes G6 5.1.1 throw "Edge not found" under rapid add/clear.
function buildBaseData(agents: ReturnType<typeof useStore.getState>["agents"]): GraphData {
  const list = Object.values(agents).filter((a) => !a.explicit);
  const nodes: NonNullable<GraphData["nodes"]> = [
    { id: DASHBOARD_ID, data: { label: "◆ 控制面板", dashboard: true, color: "#3b82f6" } },
  ];
  for (const a of list) {
    nodes.push({
      id: a.session_id,
      data: { label: `${a.name}\n${a.model}`, color: a.color, status: a.status },
    });
  }
  const edges: NonNullable<GraphData["edges"]> = list.map((a) => ({
    id: `base-${a.session_id}`,
    source: DASHBOARD_ID,
    target: a.session_id,
    data: { color: "#e2e8f0" },
  }));
  return { nodes, edges };
}

export function FlowGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const agents = useStore((s) => s.agents);
  const flows = useStore((s) => s.flows);
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
      data: buildBaseData(useStore.getState().agents),
      layout: asLayout(LAYOUTS.force),
      node: {
        type: "rect",
        style: {
          size: [150, 50],
          radius: 12,
          fill: "#ffffff",
          stroke: (d: any) => d.data?.color ?? "#e2e8f0",
          lineWidth: (d: any) => (d.data?.dashboard ? 2 : 1.5),
          labelText: (d: any) => d.data?.label ?? d.id,
          labelFill: "#0f172a",
          labelFontSize: 11,
          labelFontWeight: 600,
          labelPlacement: "center",
          opacity: (d: any) =>
            d.data?.status === "offline" ? 0.4 : d.data?.status === "stale" ? 0.65 : 1,
        },
      },
      edge: {
        style: {
          stroke: (d: any) => d.data?.color ?? "#e2e8f0",
          lineWidth: (d: any) => (d.data?.pulse ? 2.5 : 1.5),
          endArrow: (d: any) => !!d.data?.pulse,
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
    return () => {
      graphRef.current = null;
      // Defer destroy until the in-flight render settles, so StrictMode's
      // mount→cleanup→mount cycle never destroys a graph mid-render.
      void rendered.finally(() => graph.destroy());
    };
  }, [select]);

  // Rebuild base nodes/edges only when the agent pool changes (rare).
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    try {
      g.setData(buildBaseData(agents));
      // Base data no longer carries pulse edges; clear our reconciliation set so
      // the pulse effect re-adds any still-active flows on the fresh dataset.
      drawn.current.clear();
      g.render().catch(() => {});
    } catch {}
  }, [agents]);

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
