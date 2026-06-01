export interface RealAgent {
  name: string;
  color: string;
  purpose: string;
}
export interface RealScenario {
  id: string;
  title: string;
  blurb: string;
  agents: RealAgent[];
  leadName: string;
  inputLabel: string;
  defaultInput: string;
  buildPrompt: (input: string) => string;
}

const hierarchy: RealScenario = {
  id: "hierarchy",
  title: "层级编排(演示)",
  blurb: "boss 向两个 lead 分派并汇总",
  leadName: "boss",
  agents: [
    { name: "boss", color: "#3b82f6", purpose: "层级根:统筹并向下分派任务" },
    { name: "lead-a", color: "#10b981", purpose: "组长 A" },
    { name: "lead-b", color: "#f59e0b", purpose: "组长 B" },
  ],
  inputLabel: "下发给 boss 的任务…",
  defaultInput:
    "请分别询问 lead-a 和 lead-b:你负责领域里最该优先解决的一个问题是什么?汇总两人的回答后给我一个结论。",
  buildPrompt: (input) =>
    `你是层级根 boss。${input}\n用你的 coms 工具联系 lead-a 与 lead-b,保持最少往返,完成后把结论报告给我。`,
};

const bid: RealScenario = {
  id: "bid",
  title: "标书制作(投标响应)",
  blurb: "bid-lead 拆解 RFP → 分派写作 → 合规校验 → 整合",
  leadName: "bid-lead",
  agents: [
    { name: "bid-lead", color: "#3b82f6", purpose: "投标负责人:拆解 RFP、分派、整合、自检" },
    { name: "tech-writer", color: "#10b981", purpose: "技术方案撰写" },
    { name: "commercial", color: "#f59e0b", purpose: "商务/资质/报价撰写" },
    { name: "compliance", color: "#ef4444", purpose: "合规审查:对照废标项/资格条件校验" },
  ],
  inputLabel: "粘贴招标文件(RFP)要点 / 评分项 / 废标项…",
  defaultInput:
    "项目:XX 政务云平台采购\n资格:近3年同类业绩≥2;ISO27001;注册资金≥500万\n技术评分:架构30 / 安全合规25 / 实施方案20 / 售后15 / 案例10\n废标项:未提供资质原件扫描件;报价超预算1200万;技术方案缺少等保三级方案",
  buildPrompt: (input) =>
    `你是投标负责人 bid-lead。以下是招标文件要点:\n${input}\n\n请用你的 coms 工具协调:\n① 把技术方案章节派给 tech-writer,商务/资质/报价章节派给 commercial;\n② 两份草稿收齐后交 compliance 对照废标项与资格条件逐条校验,产出缺失项清单;\n③ 按 compliance 的问题让对应 writer 修订;\n④ 你整合出「标书大纲 + 废标项自检表」并把结论报告给我。\n保持最少往返,完成即停,不要无限循环。`,
};

const contract: RealScenario = {
  id: "contract",
  title: "合同审查(法务红线)",
  blurb: "intake 提取 → 风险标注 ↔ 红线建议互检 → 汇总意见书",
  leadName: "legal-lead",
  agents: [
    { name: "legal-lead", color: "#3b82f6", purpose: "法务负责人:统筹审查、汇总意见书" },
    { name: "intake", color: "#8b5cf6", purpose: "条款提取:结构化拆分合同条款" },
    { name: "risk-reviewer", color: "#ef4444", purpose: "风险审查:对照 playbook 标风险等级" },
    { name: "redline-drafter", color: "#10b981", purpose: "修订建议:对高风险条款出红线改法" },
  ],
  inputLabel: "粘贴合同文本 / 关键条款…",
  defaultInput:
    "1. 付款:验收后90天内支付,逾期不计利息。\n2. 违约:乙方违约按合同总额30%赔偿,甲方违约无明确责任。\n3. 知识产权:乙方交付成果全部归甲方,含乙方既有底层框架。\n4. 终止:甲方可随时无理由终止且不承担费用。\n5. 保密:无期限、无例外。",
  buildPrompt: (input) =>
    `你是法务负责人 legal-lead。以下是合同文本:\n${input}\n\n请用你的 coms 工具协调:\n① 让 intake 把合同拆成结构化条款(付款/违约/知识产权/终止/保密…);\n② 让 risk-reviewer 对照公司 playbook 标注每条风险等级与理由;\n③ 高风险条款交 redline-drafter 出红线修改建议,再交 risk-reviewer 复核是否引入新风险;\n④ 你汇总成「审查意见书 + 谈判要点」报告给我。\n保持最少往返,完成即停,不要无限循环。`,
};

export const REAL_SCENARIOS: RealScenario[] = [hierarchy, bid, contract];
