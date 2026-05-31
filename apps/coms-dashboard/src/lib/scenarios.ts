import type { StreamLine } from "../types";

export const DASHBOARD_ID = "__dashboard__";

export interface ScenarioAgent {
  session_id: string;
  name: string;
  model: string;
  provider?: string;
  color: string;
  purpose: string;
}

export interface ScenarioStep {
  delay: number;
  kind: StreamLine["kind"];
  from: string;
  to: string;
  fromSession: string;
  toSession: string;
  text: string;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  agents: ScenarioAgent[];
  steps: ScenarioStep[];
}

export const SCENARIOS: Scenario[] = [
  // ── Scenario 1 ────────────────────────────────────────────────────────────
  {
    id: "prod-dev-pii",
    title: "Prod/Dev 复现 (PII 脱敏)",
    blurb: "脱敏数据跨环境复现生产 bug",
    agents: [
      {
        session_id: "DEMO-PROD",
        name: "prod-gatekeeper",
        model: "claude-opus-4-7",
        provider: "anthropic",
        color: "#ef4444",
        purpose: "生产守门人:裁剪并脱敏数据,绝不泄露 PII",
      },
      {
        session_id: "DEMO-DEV",
        name: "dev-repro",
        model: "gpt-5.5",
        provider: "openai",
        color: "#10b981",
        purpose: "在本地复现 Pro 用户被误锁的生产 bug",
      },
    ],
    steps: [
      { delay: 200,  kind: "prompt",   from: "dashboard",       to: "dev-repro",       fromSession: "__dashboard__", toSession: "DEMO-DEV",  text: "复现 Pro 用户被错误锁定的生产 bug。数据在 prod,务必脱敏,别碰 PII。" },
      { delay: 1200, kind: "prompt",   from: "dev-repro",       to: "prod-gatekeeper", fromSession: "DEMO-DEV",      toSession: "DEMO-PROD", text: "请把涉及被锁 Pro 用户的那段数据,去除 PII 后发我,我导入本地库复现。" },
      { delay: 2600, kind: "response", from: "prod-gatekeeper", to: "dev-repro",       fromSession: "DEMO-PROD",     toSession: "DEMO-DEV",  text: "已裁剪+脱敏:{ user_id:'usr_***9f2', plan:'pro', status:'locked', reason:'BILLING_MISMATCH' }。姓名/邮箱/卡号已移除。" },
      { delay: 4000, kind: "prompt",   from: "dev-repro",       to: "prod-gatekeeper", fromSession: "DEMO-DEV",      toSession: "DEMO-PROD", text: "导入成功并复现:续费成功但 plan_expiry 未刷新导致误锁。prod 上 expiry 字段是什么时区?" },
      { delay: 5400, kind: "response", from: "prod-gatekeeper", to: "dev-repro",       fromSession: "DEMO-PROD",     toSession: "DEMO-DEV",  text: "确认:expiry 存 UTC,锁定任务按本地时区比较 → 边界误判。附 3 条样本时间戳。" },
      { delay: 6800, kind: "response", from: "dev-repro",       to: "dashboard",       fromSession: "DEMO-DEV",      toSession: "__dashboard__", text: "结论:锁定逻辑时区 bug,修复为统一用 UTC 比较 plan_expiry,本地已验证通过。PII 全程未离开 prod。" },
    ],
  },

  // ── Scenario 2 ────────────────────────────────────────────────────────────
  {
    id: "tool-migration",
    title: "工具迁移 E2B↔exe.dev",
    blurb: "两个工具专家协作做 feature parity 迁移",
    agents: [
      {
        session_id: "DEMO-E2B",
        name: "e2b-expert",
        model: "claude-opus-4-7",
        provider: "anthropic",
        color: "#f59e0b",
        purpose: "E2B sandbox skill 专家",
      },
      {
        session_id: "DEMO-EXE",
        name: "exedev-builder",
        model: "gpt-5.5",
        provider: "openai",
        color: "#8b5cf6",
        purpose: "从零构建 exe.dev 对等 skill",
      },
    ],
    steps: [
      { delay: 200,  kind: "prompt",   from: "dashboard",    to: "e2b-expert",     fromSession: "__dashboard__", toSession: "DEMO-E2B", text: "把现有 E2B sandbox skill 的能力清单整理出来,供迁移参考。" },
      { delay: 1300, kind: "response", from: "e2b-expert",   to: "dashboard",      fromSession: "DEMO-E2B",      toSession: "__dashboard__", text: "已产出 feature inventory:create/exec/upload/download/timeout/snapshot 等 12 项,含命令与 quirks。" },
      { delay: 2500, kind: "prompt",   from: "dashboard",    to: "exedev-builder", fromSession: "__dashboard__", toSession: "DEMO-EXE", text: "参照 E2B 清单,从零构建 exe.dev 对等 skill,不确定就问 e2b-expert。" },
      { delay: 3800, kind: "prompt",   from: "exedev-builder", to: "e2b-expert",   fromSession: "DEMO-EXE",      toSession: "DEMO-E2B", text: "exe.dev 没有 snapshot,你们 snapshot 是冻结整个 FS 吗?对等怎么做?" },
      { delay: 5200, kind: "response", from: "e2b-expert",   to: "exedev-builder", fromSession: "DEMO-E2B",      toSession: "DEMO-EXE", text: "对,冻结 FS+进程态。exe.dev 可用 fork 实例近似,记到差异表。" },
      { delay: 6600, kind: "response", from: "exedev-builder", to: "dashboard",    fromSession: "DEMO-EXE",      toSession: "__dashboard__", text: "完成:exe.dev skill + feature parity 文档,差异 3 项(snapshot/区域/计费)已列出。" },
    ],
  },

  // ── Scenario 3 ────────────────────────────────────────────────────────────
  {
    id: "verifier",
    title: "Verifier 校验复核",
    blurb: "一个产出、一个充当 reviewer 校验",
    agents: [
      {
        session_id: "DEMO-AUTHOR",
        name: "author",
        model: "gpt-5.5",
        provider: "openai",
        color: "#3b82f6",
        purpose: "实现功能",
      },
      {
        session_id: "DEMO-REVIEWER",
        name: "reviewer",
        model: "claude-opus-4-7",
        provider: "anthropic",
        color: "#10b981",
        purpose: "逐条校验并纠错",
      },
    ],
    steps: [
      { delay: 200,  kind: "prompt",   from: "dashboard", to: "author",   fromSession: "__dashboard__",  toSession: "DEMO-AUTHOR",   text: "实现登录限流,完成后交 reviewer 校验。" },
      { delay: 1300, kind: "prompt",   from: "author",    to: "reviewer", fromSession: "DEMO-AUTHOR",    toSession: "DEMO-REVIEWER", text: "限流用滑动窗口,每 IP 60s 内 10 次,超限 429。帮我审。" },
      { delay: 2700, kind: "response", from: "reviewer",  to: "author",   fromSession: "DEMO-REVIEWER",  toSession: "DEMO-AUTHOR",   text: "3 个问题:① 未防 X-Forwarded-For 伪造 ② 本地时钟有时区漂移 ③ 缺单测。" },
      { delay: 4200, kind: "prompt",   from: "author",    to: "reviewer", fromSession: "DEMO-AUTHOR",    toSession: "DEMO-REVIEWER", text: "已改:取可信代理链首 IP、改用单调时钟、补了 5 条单测。再看?" },
      { delay: 5600, kind: "response", from: "reviewer",  to: "author",   fromSession: "DEMO-REVIEWER",  toSession: "DEMO-AUTHOR",   text: "通过。X-Forwarded-For 处理正确,单测覆盖边界。" },
      { delay: 7000, kind: "response", from: "author",    to: "dashboard", fromSession: "DEMO-AUTHOR",   toSession: "__dashboard__", text: "限流已实现并通过复核,附测试报告。" },
    ],
  },

  // ── Scenario 4 ────────────────────────────────────────────────────────────
  {
    id: "oncall",
    title: "事故 Oncall 排查",
    blurb: "oncall 联合 DB/日志专家定位根因",
    agents: [
      {
        session_id: "DEMO-ONCALL",
        name: "oncall",
        model: "claude-opus-4-7",
        provider: "anthropic",
        color: "#ef4444",
        purpose: "事故指挥",
      },
      {
        session_id: "DEMO-LOG",
        name: "log-expert",
        model: "gpt-5.5",
        provider: "openai",
        color: "#8b5cf6",
        purpose: "日志聚类",
      },
      {
        session_id: "DEMO-DB",
        name: "db-expert",
        model: "gpt-5.5",
        provider: "openai",
        color: "#f59e0b",
        purpose: "数据库排查",
      },
    ],
    steps: [
      { delay: 200,  kind: "prompt",   from: "dashboard",  to: "oncall",     fromSession: "__dashboard__", toSession: "DEMO-ONCALL", text: "P1:支付接口 5xx 飙升,排查。" },
      { delay: 1300, kind: "prompt",   from: "oncall",     to: "log-expert", fromSession: "DEMO-ONCALL",   toSession: "DEMO-LOG",    text: "拉最近 10 分钟 payment 服务的 error 日志聚类。" },
      { delay: 2600, kind: "response", from: "log-expert", to: "oncall",     fromSession: "DEMO-LOG",      toSession: "DEMO-ONCALL", text: "90% 是 'db connection timeout',集中在 16:02 之后。" },
      { delay: 3900, kind: "prompt",   from: "oncall",     to: "db-expert",  fromSession: "DEMO-ONCALL",   toSession: "DEMO-DB",     text: "payment 库 16:02 后连接超时,连接池/慢查询看一下。" },
      { delay: 5300, kind: "response", from: "db-expert",  to: "oncall",     fromSession: "DEMO-DB",       toSession: "DEMO-ONCALL", text: "连接池打满:一条缺索引的对账查询全表扫描锁住连接。已加索引。" },
      { delay: 6800, kind: "response", from: "oncall",     to: "dashboard",  fromSession: "DEMO-ONCALL",   toSession: "__dashboard__", text: "根因:对账查询缺索引拖垮连接池。已加索引,5xx 回落,复盘待补。" },
    ],
  },

  // ── Scenario 5 ────────────────────────────────────────────────────────────
  {
    id: "multi-model",
    title: "多模型互检",
    blurb: "GPT 与 Claude 就同一问题互检",
    agents: [
      {
        session_id: "DEMO-GPT",
        name: "gpt-side",
        model: "gpt-5.5",
        provider: "openai",
        color: "#10b981",
        purpose: "GPT 视角审查",
      },
      {
        session_id: "DEMO-CLAUDE",
        name: "claude-side",
        model: "claude-opus-4-7",
        provider: "anthropic",
        color: "#8b5cf6",
        purpose: "Claude 视角审查",
      },
    ],
    steps: [
      { delay: 200,  kind: "prompt",   from: "dashboard",  to: "gpt-side",    fromSession: "__dashboard__", toSession: "DEMO-GPT",    text: "这段并发去重代码有没有 bug?和 claude-side 互检一下。" },
      { delay: 1300, kind: "prompt",   from: "gpt-side",   to: "claude-side", fromSession: "DEMO-GPT",      toSession: "DEMO-CLAUDE", text: "我认为这里 map 非线程安全会丢数据,你怎么看?" },
      { delay: 2700, kind: "response", from: "claude-side", to: "gpt-side",   fromSession: "DEMO-CLAUDE",   toSession: "DEMO-GPT",    text: "同意,且 check-then-act 有竞态;建议 computeIfAbsent 或加锁。" },
      { delay: 4100, kind: "prompt",   from: "gpt-side",   to: "claude-side", fromSession: "DEMO-GPT",      toSession: "DEMO-CLAUDE", text: "用 ConcurrentHashMap.newKeySet() 做去重集合够吗?" },
      { delay: 5500, kind: "response", from: "claude-side", to: "gpt-side",   fromSession: "DEMO-CLAUDE",   toSession: "DEMO-GPT",    text: "够,且无锁。注意迭代弱一致性,统计场景可接受。" },
      { delay: 6900, kind: "response", from: "gpt-side",   to: "dashboard",   fromSession: "DEMO-GPT",      toSession: "__dashboard__", text: "互检结论:原代码有并发竞态,改用 ConcurrentHashMap.newKeySet();两模型一致。" },
    ],
  },
];
