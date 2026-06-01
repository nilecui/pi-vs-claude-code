// src/lib/orchestration/runScenario.ts
import type { ScenarioDef, RunDeps, StepStatus } from "./types";
import { render } from "./template";
import { validate } from "./validate";

// 与 ScenarioChat 的 ask() 共用的超时哨兵文本(ask 超时时 resolve 此串,不抛)
export const TIMEOUT_TEXT = "(超时:未收到回复)";

// 被调 agent 必须只回答、不再外联,否则会 lead↔lead 互等死锁。解释器统一追加。
export const DELEGATION_SUFFIX =
  "\n\n【只回答,不要转发】请直接把结果回复给控制面板。禁止使用 coms / coms_net 等工具联系、转发或等待其它 agent —— 你已拥有完成本步骤所需的全部信息。";

const DEFAULT_TIMEOUT = 240000;

export async function runScenario(s: ScenarioDef, input: string, deps: RunDeps): Promise<void> {
  const errs = validate(s);
  if (errs.length) {
    deps.onStatus("场景校验失败:" + errs.join(";"));
    return;
  }
  const ok = await deps.spawnMissing(s.roles);
  if (!ok) {
    deps.onStatus("部分 agent 未就绪,无法运行");
    return;
  }

  const outputs: Record<string, string> = {};
  const status = new Map<string, StepStatus>(s.steps.map((st) => [st.id, "pending"]));
  for (const st of s.steps) deps.onStepUpdate(st.id, "pending");

  const terminal = (id: string) => {
    const st = status.get(id);
    return st === "done" || st === "error" || st === "timeout";
  };
  const pending = () => s.steps.filter((st) => status.get(st.id) === "pending");

  while (pending().length) {
    const ready = pending().filter((st) => (st.after ?? []).every(terminal));
    if (ready.length === 0) break; // 校验已保证无环,理论不会到这

    deps.onStatus("运行中:" + ready.map((st) => st.role).join(" / "));
    ready.forEach((st) => status.set(st.id, "running"));
    ready.forEach((st) => deps.onStepUpdate(st.id, "running"));

    await Promise.all(
      ready.map(async (st) => {
        const prompt = render(st.prompt, { input, steps: outputs }) + DELEGATION_SUFFIX;
        try {
          const text = await deps.ask(st.role, prompt, st.timeoutMs ?? DEFAULT_TIMEOUT);
          const fin: StepStatus = text === TIMEOUT_TEXT ? "timeout" : "done";
          outputs[st.id] = text;
          status.set(st.id, fin);
          deps.onStepUpdate(st.id, fin, text);
        } catch (e) {
          const text = `(执行出错:${String(e)})`;
          outputs[st.id] = text;
          status.set(st.id, "error");
          deps.onStepUpdate(st.id, "error", text);
        }
      }),
    );
  }

  deps.onResult(assemble(s, outputs));
  deps.onStatus("完成 ✓");
}

export function assemble(s: ScenarioDef, outputs: Record<string, string>): string {
  if (s.assembly) return render(s.assembly, { input: "", steps: outputs });
  const referenced = new Set<string>();
  for (const st of s.steps) for (const d of st.after ?? []) referenced.add(d);
  const sinks = s.steps.filter((st) => !referenced.has(st.id));
  return sinks.map((st) => outputs[st.id] ?? "").join("\n\n---\n\n");
}
