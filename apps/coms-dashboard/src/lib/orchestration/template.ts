// src/lib/orchestration/template.ts

const INPUT_RE = /\{\{\s*input\s*\}\}/g;
const STEP_RE = /\{\{\s*steps\.([A-Za-z0-9_-]+)\s*\}\}/g;

export function render(tpl: string, ctx: { input: string; steps: Record<string, string> }): string {
  return tpl
    .replace(INPUT_RE, ctx.input)
    .replace(STEP_RE, (_m, id: string) => ctx.steps[id] ?? "");
}

export function collectRefs(tpl: string): { input: boolean; steps: string[] } {
  const input = /\{\{\s*input\s*\}\}/.test(tpl);
  const steps: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(STEP_RE.source, "g");
  while ((m = re.exec(tpl)) !== null) steps.push(m[1]);
  return { input, steps: [...new Set(steps)] };
}
