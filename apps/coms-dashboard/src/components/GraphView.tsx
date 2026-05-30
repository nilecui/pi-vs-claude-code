import { useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { DASHBOARD_ID, useStore } from "../store";
import type { AgentCard } from "../types";

const CENTER = { x: 430, y: 300 };
const RADIUS = 230;

const FLOW_COLOR: Record<string, string> = {
  prompt: "#38bdf8",
  response: "#34d399",
  error: "#f87171",
};

function AgentNode({ data }: NodeProps<{ agent?: AgentCard; dashboard?: boolean }>) {
  if (data.dashboard) {
    return (
      <div className="node node-dashboard">
        <Handle type="source" position={Position.Top} className="rf-handle" />
        <Handle type="target" position={Position.Top} className="rf-handle" />
        <div className="node-title">◆ control panel</div>
        <div className="node-sub">you</div>
      </div>
    );
  }
  const a = data.agent!;
  return (
    <div className={`node node-agent status-${a.status}`} style={{ borderColor: a.color }}>
      <Handle type="source" position={Position.Top} className="rf-handle" />
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <div className="node-title">
        <span className="dot" style={{ background: a.color }} /> {a.name}
      </div>
      <div className="node-sub">{a.model}</div>
      <div className="ctx-bar">
        <div className="ctx-fill" style={{ width: `${Math.min(100, a.context_used_pct)}%` }} />
      </div>
      <div className="node-meta">
        {a.status} · ctx {a.context_used_pct}% · q{a.queue_depth}
      </div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

export function GraphView() {
  const agents = useStore((s) => s.agents);
  const flows = useStore((s) => s.flows);
  const select = useStore((s) => s.select);

  const { nodes, edges } = useMemo(() => {
    const list = Object.values(agents).filter((a) => !a.explicit);
    const nodes: Node[] = [
      { id: DASHBOARD_ID, type: "agent", position: CENTER, data: { dashboard: true }, draggable: true },
    ];
    const pos: Record<string, { x: number; y: number }> = { [DASHBOARD_ID]: CENTER };
    list.forEach((a, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, list.length) - Math.PI / 2;
      const p = { x: CENTER.x + RADIUS * Math.cos(angle), y: CENTER.y + RADIUS * Math.sin(angle) };
      pos[a.session_id] = p;
      nodes.push({ id: a.session_id, type: "agent", position: p, data: { agent: a } });
    });

    // Faint resting links from the panel to every agent.
    const edges: Edge[] = list.map((a) => ({
      id: `base-${a.session_id}`,
      source: DASHBOARD_ID,
      target: a.session_id,
      style: { stroke: "#1e293b", strokeWidth: 1 },
    }));

    // Live animated pulses on top.
    for (const f of flows) {
      if (!pos[f.from] || !pos[f.to]) continue;
      edges.push({
        id: `flow-${f.id}`,
        source: f.from,
        target: f.to,
        animated: true,
        style: { stroke: FLOW_COLOR[f.kind] ?? "#38bdf8", strokeWidth: 2.5 },
        zIndex: 10,
      });
    }
    return { nodes, edges };
  }, [agents, flows]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.4}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => n.id !== DASHBOARD_ID && select(n.id)}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
