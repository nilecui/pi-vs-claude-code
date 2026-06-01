import { useEffect, useRef } from "react";
import { Graph, NodeEvent, type GraphData } from "@antv/g6";
import type { ScenarioDef } from "../lib/orchestration/types";
import { scenarioToGraph } from "../lib/scenarioGraph";

function toG6Data(s: ScenarioDef): GraphData {
  const { nodes, edges } = scenarioToGraph(s);
  return {
    nodes: nodes.map((n) => ({ id: n.id, data: { label: n.label } })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

export function ScenarioDagPreview({ scenario, onPickStep }: { scenario: ScenarioDef; onPickStep?: (id: string) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const pickRef = useRef(onPickStep);
  pickRef.current = onPickStep;

  // 创建一次
  useEffect(() => {
    const container = boxRef.current;
    if (!container) return;
    const graph = new Graph({
      container,
      data: toG6Data(scenario),
      animation: false,
      autoResize: true,
      layout: { type: "antv-dagre", rankdir: "TB", nodesep: 18, ranksep: 30 },
      node: {
        type: "rect",
        style: {
          size: [120, 28], radius: 6,
          fill: "#eff6ff", stroke: "#3b82f6", lineWidth: 1,
          labelText: (d: any) => String(d.data?.label ?? d.id), labelFill: "#1e3a8a", labelFontSize: 11, labelPlacement: "center",
        },
      },
      edge: { type: "polyline", style: { stroke: "#94a3b8", lineWidth: 1, endArrow: true, endArrowSize: 6 } },
      behaviors: ["drag-canvas", "zoom-canvas"],
      padding: 16,
    } as any);
    graph.on(NodeEvent.CLICK, (evt: any) => {
      const id = evt?.target?.id;
      if (id && pickRef.current) pickRef.current(String(id));
    });
    graphRef.current = graph;
    const rendered = graph.render().catch(() => {});
    return () => {
      graphRef.current = null;
      void rendered.finally(() => { try { graph.destroy(); } catch { /* already destroyed */ } });
    };
    // 仅创建一次;数据更新在下面 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 场景变 → 重置数据并重画
  useEffect(() => {
    const g = graphRef.current;
    if (!g || g.destroyed) return;
    g.setData(toG6Data(scenario));
    g.render().then(() => { if (!g.destroyed) g.fitView({ when: "always" } as any); }).catch(() => {});
  }, [scenario]);

  return <div className="dag-preview" ref={boxRef} />;
}
