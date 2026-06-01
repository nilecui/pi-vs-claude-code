// src/lib/orchestration/validate.ts
import type { ScenarioDef, StepDef } from "./types";
import { collectRefs } from "./template";

export function validate(s: ScenarioDef): string[] {
  const errors: string[] = [];
  if (!s.roles || s.roles.length === 0) errors.push("roles 不能为空");
  if (!s.steps || s.steps.length === 0) errors.push("steps 不能为空");

  const roleNames = new Set((s.roles ?? []).map((r) => r.name));
  const ids = (s.steps ?? []).map((st) => st.id);
  const idSet = new Set(ids);
  const byId = new Map((s.steps ?? []).map((st) => [st.id, st]));
  const seen = new Set<string>();

  for (const st of s.steps ?? []) {
    if (!st.id) errors.push("存在空的 step id");
    else if (seen.has(st.id)) errors.push(`step id 重复: ${st.id}`);
    seen.add(st.id);
    if (!roleNames.has(st.role)) errors.push(`step ${st.id} 引用了未定义的 role: ${st.role}`);
    for (const dep of st.after ?? []) {
      if (!idSet.has(dep)) errors.push(`step ${st.id} 的 after 引用了不存在的 step: ${dep}`);
    }
    const closure = transitiveAfter(st, byId);
    for (const ref of collectRefs(st.prompt).steps) {
      if (!idSet.has(ref)) errors.push(`step ${st.id} 的 prompt 引用了不存在的 step: ${ref}`);
      else if (!closure.has(ref)) errors.push(`step ${st.id} 的 prompt 引用了 {{steps.${ref}}},但它不在该步骤的(传递)依赖中`);
    }
  }
  if (s.assembly) {
    for (const ref of collectRefs(s.assembly).steps) {
      if (!idSet.has(ref)) errors.push(`assembly 引用了不存在的 step: ${ref}`);
    }
  }
  if (errors.length === 0 && hasCycle(s)) errors.push("steps 依赖存在环");
  return errors;
}

// 返回 st 通过 after 边可达的所有上游 step id(传递闭包,不含 st 自身)。
function transitiveAfter(st: StepDef, byId: Map<string, StepDef>): Set<string> {
  const closure = new Set<string>();
  const stack = [...(st.after ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (closure.has(id)) continue;
    closure.add(id);
    const dep = byId.get(id);
    if (dep) for (const up of dep.after ?? []) stack.push(up);
  }
  return closure;
}

function hasCycle(s: ScenarioDef): boolean {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const st of s.steps) {
    indeg.set(st.id, 0);
    adj.set(st.id, []);
  }
  for (const st of s.steps) {
    for (const dep of st.after ?? []) {
      adj.get(dep)?.push(st.id);
      indeg.set(st.id, (indeg.get(st.id) ?? 0) + 1);
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const nb of adj.get(id) ?? []) {
      indeg.set(nb, (indeg.get(nb) ?? 0) - 1);
      if (indeg.get(nb) === 0) queue.push(nb);
    }
  }
  return visited !== s.steps.length;
}
