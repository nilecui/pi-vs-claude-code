import { useEffect, useRef, useState } from "react";
import { Graph, NodeEvent, type GraphData, type LayoutOptions } from "@antv/g6";
import { DASHBOARD_ID, useStore } from "../store";

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

function buildData(
  agents: ReturnType<typeof useStore.getState>["agents"],
  flows: ReturnType<typeof useStore.getState>["flows"],
): GraphData {
  const list = Object.values(agents).filter((a) => !a.explicit);
  const nodes: NonNullable<GraphData["nodes"]> = [
    { id: DASHBOARD_ID, data: { label: "◆ control panel", dashboard: true, color: "#3b82f6" } },
  ];
  for (const a of list) {
    nodes.push({
      id: a.session_id,
      data: { label: `${a.name}\n${a.model}`, color: a.color, status: a.status },
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: NonNullable<GraphData["edges"]> = list.map((a) => ({
    id: `base-${a.session_id}`,
    source: DASHBOARD_ID,
    target: a.session_id,
    data: { color: "#e2e8f0" },
  }));
  for (const f of flows) {
    if (!ids.has(f.from) || !ids.has(f.to)) continue;
    edges.push({
      id: `flow-${f.id}`,
      source: f.from,
      target: f.to,
      data: { color: FLOW_COLOR[f.kind] ?? "#3b82f6", pulse: true },
    });
  }
  return { nodes, edges };
}

export function FlowGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const agents = useStore((s) => s.agents);
  const flows = useStore((s) => s.flows);
  const select = useStore((s) => s.select);
  const [layout, setLayout] = useState<LayoutKey>("force");

  // Create once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      autoFit: "center",
      data: buildData(useStore.getState().agents, useStore.getState().flows),
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
    graph.render().catch(() => {});
    graphRef.current = graph;
    return () => {
      graph.destroy();
      graphRef.current = null;
    };
  }, [select]);

  // Update data on agents/flows change.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    g.setData(buildData(agents, flows));
    g.render().catch(() => {});
  }, [agents, flows]);

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
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
