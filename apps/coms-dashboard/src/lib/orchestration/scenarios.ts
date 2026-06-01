// src/lib/orchestration/scenarios.ts
import type { ScenarioDef } from "./types";

const hierarchy: ScenarioDef = {
  id: "hierarchy",
  title: "层级编排(演示)",
  blurb: "面板并行问两个 lead → boss 汇总",
  roles: [
    { name: "boss", color: "#3b82f6", provider: "openai-codex", model: "gpt-5.5", purpose: "层级根:汇总两位组长的回答" },
    { name: "lead-a", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "组长 A" },
    { name: "lead-b", color: "#f59e0b", provider: "openai-codex", model: "gpt-5.5", purpose: "组长 B" },
  ],
  input: { label: "下发的任务…", default: "你负责领域里最该优先解决的一个问题是什么?请用 2-3 句简洁回答。" },
  steps: [
    { id: "lead-a", role: "lead-a", prompt: "你是组长 lead-a。任务:{{input}}", after: [] },
    { id: "lead-b", role: "lead-b", prompt: "你是组长 lead-b。任务:{{input}}", after: [] },
    {
      id: "boss",
      role: "boss",
      prompt: "你是 boss。下面是两位组长对同一任务的回答,请汇总后给出一个综合结论(用 Markdown)。\n\n【lead-a】\n{{steps.lead-a}}\n\n【lead-b】\n{{steps.lead-b}}",
      after: ["lead-a", "lead-b"],
    },
  ],
  assembly: "# 综合结论(boss)\n\n{{steps.boss}}\n\n---\n\n## 附:lead-a 原始回答\n\n{{steps.lead-a}}\n\n## 附:lead-b 原始回答\n\n{{steps.lead-b}}",
};

const bid: ScenarioDef = {
  id: "bid",
  title: "标书制作(投标响应)",
  blurb: "面板并行派写作 → compliance 校验 → bid-lead 整合",
  roles: [
    { name: "bid-lead", color: "#3b82f6", provider: "openai-codex", model: "gpt-5.5", purpose: "投标负责人:整合标书大纲 + 废标项自检表" },
    { name: "tech-writer", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "技术方案撰写" },
    { name: "commercial", color: "#f59e0b", provider: "openai-codex", model: "gpt-5.5", purpose: "商务/资质/报价撰写" },
    { name: "compliance", color: "#ef4444", provider: "openai-codex", model: "gpt-5.5", purpose: "合规审查:对照废标项/资格条件校验" },
  ],
  input: {
    label: "粘贴招标文件(RFP)要点 / 评分项 / 废标项…",
    default:
      "项目:XX 政务云平台采购\n资格:近3年同类业绩≥2;ISO27001;注册资金≥500万\n技术评分:架构30 / 安全合规25 / 实施方案20 / 售后15 / 案例10\n废标项:未提供资质原件扫描件;报价超预算1200万;技术方案缺少等保三级方案",
  },
  steps: [
    { id: "tech", role: "tech-writer", after: [], prompt: "你是技术方案撰写 tech-writer。根据以下 RFP 撰写「技术方案章节」(总体架构/安全合规/实施方案/售后/案例,并单列等保三级安全建设方案),用 Markdown,要点清晰。\n\nRFP:\n{{input}}" },
    { id: "comm", role: "commercial", after: [], prompt: "你是商务撰写 commercial。根据以下 RFP 撰写「商务/资质/报价章节」(资格条件逐项响应、报价不超预算、资质清单),用 Markdown。\n\nRFP:\n{{input}}" },
    { id: "comp", role: "compliance", after: ["tech", "comm"], prompt: "你是合规审查 compliance。对照下面 RFP 的「资格条件 + 废标项」,逐条校验两份草稿是否满足,输出「缺失项清单 + 整改建议」(Markdown 表格)。\n\nRFP:\n{{input}}\n\n【技术稿】\n{{steps.tech}}\n\n【商务稿】\n{{steps.comm}}" },
    { id: "lead", role: "bid-lead", after: ["comp"], prompt: "你是投标负责人 bid-lead。请整合下面材料,输出「标书大纲 + 废标项自检表」(Markdown),并在末尾给出投标重点结论。\n\nRFP:\n{{input}}\n\n【技术稿】\n{{steps.tech}}\n\n【商务稿】\n{{steps.comm}}\n\n【合规校验】\n{{steps.comp}}" },
  ],
  assembly: [
    "# 投标文件 · 完整版",
    "",
    "## 第一部分 · 标书大纲与废标项自检(bid-lead 整合)",
    "",
    "{{steps.lead}}",
    "",
    "---",
    "",
    "## 第二部分 · 技术方案(正文,tech-writer)",
    "",
    "{{steps.tech}}",
    "",
    "---",
    "",
    "## 第三部分 · 商务 / 资质 / 报价(正文,commercial)",
    "",
    "{{steps.comm}}",
    "",
    "---",
    "",
    "## 附 · 合规校验与整改建议(compliance)",
    "",
    "{{steps.comp}}",
  ].join("\n"),
};

const contract: ScenarioDef = {
  id: "contract",
  title: "合同审查(法务红线)",
  blurb: "intake 提取 → 风险标注 → 红线 → 风险复核 → legal-lead 汇总",
  roles: [
    { name: "legal-lead", color: "#3b82f6", provider: "openai-codex", model: "gpt-5.5", purpose: "法务负责人:汇总审查意见书 + 谈判要点" },
    { name: "intake", color: "#8b5cf6", provider: "openai-codex", model: "gpt-5.5", purpose: "条款提取:结构化拆分合同条款" },
    { name: "risk-reviewer", color: "#ef4444", provider: "openai-codex", model: "gpt-5.5", purpose: "风险审查:对照 playbook 标风险等级" },
    { name: "redline-drafter", color: "#10b981", provider: "openai-codex", model: "gpt-5.5", purpose: "修订建议:对高风险条款出红线改法" },
  ],
  input: {
    label: "粘贴合同文本 / 关键条款…",
    default:
      "1. 付款:验收后90天内支付,逾期不计利息。\n2. 违约:乙方违约按合同总额30%赔偿,甲方违约无明确责任。\n3. 知识产权:乙方交付成果全部归甲方,含乙方既有底层框架。\n4. 终止:甲方可随时无理由终止且不承担费用。\n5. 保密:无期限、无例外。",
  },
  steps: [
    { id: "intake", role: "intake", after: [], prompt: "你是条款提取 intake。把下面合同拆成结构化条款清单(付款/违约/知识产权/终止/保密…),每条标注编号与原文要点,用 Markdown。\n\n合同:\n{{input}}" },
    { id: "risk", role: "risk-reviewer", after: ["intake"], prompt: "你是风险审查 risk-reviewer。对照通用法务 playbook,对下面每条条款标注风险等级(高/中/低)与理由,用 Markdown 表格。\n\n条款:\n{{steps.intake}}" },
    { id: "redline", role: "redline-drafter", after: ["risk"], prompt: "你是修订建议 redline-drafter。针对下面高/中风险条款给出「红线修改建议」(原文 → 建议改法 → 理由),用 Markdown。\n\n风险标注:\n{{steps.risk}}" },
    { id: "recheck", role: "risk-reviewer", after: ["redline"], prompt: "你是风险审查 risk-reviewer。复核下面的红线修改建议是否引入新风险或与其他条款冲突,逐条给出复核意见(通过/需调整 + 理由)。\n\n红线建议:\n{{steps.redline}}" },
    { id: "legal", role: "legal-lead", after: ["recheck"], prompt: "你是法务负责人 legal-lead。请汇总下面材料,输出最终「合同审查意见书 + 谈判要点」(Markdown),按风险优先级排列。\n\n条款:\n{{steps.intake}}\n\n风险:\n{{steps.risk}}\n\n红线:\n{{steps.redline}}\n\n复核:\n{{steps.recheck}}" },
  ],
  assembly: [
    "# 合同审查报告 · 完整版",
    "",
    "## 第一部分 · 审查意见书与谈判要点(legal-lead)",
    "",
    "{{steps.legal}}",
    "",
    "---",
    "",
    "## 第二部分 · 结构化条款(intake)",
    "",
    "{{steps.intake}}",
    "",
    "## 第三部分 · 风险标注(risk-reviewer)",
    "",
    "{{steps.risk}}",
    "",
    "## 第四部分 · 红线修改建议(redline-drafter)",
    "",
    "{{steps.redline}}",
    "",
    "## 第五部分 · 红线复核(risk-reviewer)",
    "",
    "{{steps.recheck}}",
  ].join("\n"),
};

export const SCENARIOS: ScenarioDef[] = [hierarchy, bid, contract];
