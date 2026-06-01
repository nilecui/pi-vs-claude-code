import type { ScenarioDef, RoleDef, StepDef } from "./orchestration/types";

export function blankScenario(): ScenarioDef {
  return { id: "", title: "", blurb: "", roles: [], input: { label: "", default: "" }, steps: [], assembly: "" };
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addRole(s: ScenarioDef): ScenarioDef {
  const taken = new Set(s.roles.map((r) => r.name));
  const name = uniqueName(`role-${s.roles.length + 1}`, taken);
  return { ...s, roles: [...s.roles, { name, provider: "openai-codex", model: "gpt-5.5", purpose: "", color: "#3b82f6" }] };
}
export function updateRole(s: ScenarioDef, i: number, patch: Partial<RoleDef>): ScenarioDef {
  return { ...s, roles: s.roles.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) };
}
export function removeRole(s: ScenarioDef, i: number): ScenarioDef {
  return { ...s, roles: s.roles.filter((_, idx) => idx !== i) };
}

export function addStep(s: ScenarioDef): ScenarioDef {
  const taken = new Set(s.steps.map((st) => st.id));
  const id = uniqueName(`step-${s.steps.length + 1}`, taken);
  return { ...s, steps: [...s.steps, { id, role: s.roles[0]?.name ?? "", prompt: "", after: [] }] };
}
export function updateStep(s: ScenarioDef, i: number, patch: Partial<StepDef>): ScenarioDef {
  return { ...s, steps: s.steps.map((st, idx) => (idx === i ? { ...st, ...patch } : st)) };
}
export function removeStep(s: ScenarioDef, i: number): ScenarioDef {
  const removedId = s.steps[i]?.id;
  return {
    ...s,
    steps: s.steps
      .filter((_, idx) => idx !== i)
      .map((st) => (removedId ? { ...st, after: st.after.filter((a) => a !== removedId) } : st)),
  };
}
export function toggleAfter(s: ScenarioDef, stepIdx: number, depId: string): ScenarioDef {
  return {
    ...s,
    steps: s.steps.map((st, idx) => {
      if (idx !== stepIdx) return st;
      const has = st.after.includes(depId);
      return { ...st, after: has ? st.after.filter((a) => a !== depId) : [...st.after, depId] };
    }),
  };
}
export function renameStepId(s: ScenarioDef, i: number, newId: string): ScenarioDef {
  const oldId = s.steps[i]?.id;
  return {
    ...s,
    steps: s.steps.map((st, idx) => {
      const id = idx === i ? newId : st.id;
      const after = oldId && oldId !== newId ? st.after.map((a) => (a === oldId ? newId : a)) : st.after;
      return { ...st, id, after };
    }),
  };
}
