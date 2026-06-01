// src/lib/orchestration/types.ts

export interface RoleDef {
  name: string; // coms-net 上的 agent 名;steps 用它引用
  provider: string; // 如 "openai-codex"
  model: string; // 如 "gpt-5.5"
  purpose: string;
  color: string;
}

export interface StepDef {
  id: string; // 场景内唯一
  role: string; // 引用 RoleDef.name
  prompt: string; // 模板:支持 {{input}} 与 {{steps.<id>}}
  after: string[]; // 依赖的 step id;[] = 无依赖(就绪即并行)
  timeoutMs?: number; // 缺省 240000
}

export interface ScenarioDef {
  id: string;
  title: string;
  blurb: string;
  roles: RoleDef[];
  input: { label: string; default: string };
  steps: StepDef[];
  assembly?: string; // 模板;缺省 = 汇点步骤产出拼接
  maxConcurrency?: number; // 就绪批次最大并发(缺省 6);宽扇出时排队跑,防洪峰
}

export type StepStatus = "pending" | "running" | "done" | "error" | "timeout";

export interface RunDeps {
  // 向某 role 发一条消息并解析为该消息的回复(超时返回 TIMEOUT_TEXT,不抛)
  ask: (role: string, prompt: string, timeoutMs: number) => Promise<string>;
  // 起缺失角色、等注册;全部就绪返回 true
  spawnMissing: (roles: RoleDef[]) => Promise<boolean>;
  onStepUpdate: (id: string, status: StepStatus, text?: string) => void;
  onStatus: (msg: string) => void;
  onResult: (markdown: string) => void;
}
