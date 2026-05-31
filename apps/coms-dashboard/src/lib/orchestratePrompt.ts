/** Builds the prompt the dashboard sends to agent A so A contacts agent B itself
 *  (orchestrate-via-prompt; no impersonation). Includes an anti-loop guard. */
export function orchestratePrompt(toName: string, task: string): string {
  return [
    `Use your coms tool to message agent "${toName}".`,
    `Task: ${task}`,
    `When you have the answer, report the conclusion back to me directly.`,
    `Do not loop indefinitely with ${toName} — keep it to the minimum exchanges needed, then stop.`,
  ].join("\n");
}
