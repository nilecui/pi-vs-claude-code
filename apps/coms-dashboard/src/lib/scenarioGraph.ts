import type { ScenarioDef } from "./orchestration/types";

export interface DagNode { id: string; label: string; }
export interface DagEdge { source: string; target: string; }

export function scenarioToGraph(s: ScenarioDef): { nodes: DagNode[]; edges: DagEdge[] } {
  const ids = new Set(s.steps.map((st) => st.id));
  const nodes: DagNode[] = s.steps.map((st) => ({ id: st.id, label: st.role ? `${st.id} · ${st.role}` : st.id }));
  const edges: DagEdge[] = [];
  for (const st of s.steps) {
    for (const dep of st.after ?? []) {
      if (ids.has(dep) && dep !== st.id) edges.push({ source: dep, target: st.id });
    }
  }
  return { nodes, edges };
}
