export interface RealAgent {
  name: string;
  color: string;
  purpose: string;
}

// Deterministic orchestration context. The dashboard (not a "lead" agent)
// drives the fan-out: `ask` sends a message to one agent and resolves with
// that agent's reply, so every teammate is guaranteed to participate and the
// intermediate steps are always visible in the chat thread.
export interface OrchestrateCtx {
  input: string;
  ask: (agent: string, prompt: string) => Promise<string>;
  setStatus: (s: string) => void;
  // The panel assembles the final deliverable losslessly from each role's real
  // output (no LLM re-typing), then hands it here for the "查看完整产出" view.
  setResult: (markdown: string) => void;
}

export interface RealScenario {
  id: string;
  title: string;
  blurb: string;
  agents: RealAgent[];
  leadName: string; // the agent that produces the final, integrated deliverable
  inputLabel: string;
  defaultInput: string;
  orchestrate: (ctx: OrchestrateCtx) => Promise<void>;
}

const hierarchy: RealScenario = {
  id: "hierarchy",
  title: "层级编排(演示)",
  blurb: "面板并行问两个 lead → boss 汇总",
  leadName: "boss",
  agents: [
    { name: "boss", color: "#3b82f6", purpose: "层级根:汇总两位组长的回答" },
    { name: "lead-a", color: "#10b981", purpose: "组长 A" },
    { name: "lead-b", color: "#f59e0b", purpose: "组长 B" },
  ],
  inputLabel: "下发的任务…",
  defaultInput:
    "你负责领域里最该优先解决的一个问题是什么?请用 2-3 句简洁回答。",
  orchestrate: async ({ input, ask, setStatus, setResult }) => {
    setStatus("lead-a / lead-b 并行作答…");
    const [a, b] = await Promise.all([
      ask("lead-a", `你是组长 lead-a。任务:${input}`),
      ask("lead-b", `你是组长 lead-b。任务:${input}`),
    ]);
    setStatus("boss 汇总两人结论…");
    const boss = await ask(
      "boss",
      `你是 boss。下面是两位组长对同一任务的回答,请汇总后给出一个综合结论(用 Markdown)。\n\n【lead-a】\n${a}\n\n【lead-b】\n${b}`,
    );
    setResult(
      `# 综合结论(boss)\n\n${boss}\n\n---\n\n## 附:lead-a 原始回答\n\n${a}\n\n## 附:lead-b 原始回答\n\n${b}`,
    );
    setStatus("完成 ✓");
  },
};

const bid: RealScenario = {
  id: "bid",
  title: "标书制作(投标响应)",
  blurb: "面板并行派写作 → compliance 校验 → bid-lead 整合",
  leadName: "bid-lead",
  agents: [
    { name: "bid-lead", color: "#3b82f6", purpose: "投标负责人:整合标书大纲 + 废标项自检表" },
    { name: "tech-writer", color: "#10b981", purpose: "技术方案撰写" },
    { name: "commercial", color: "#f59e0b", purpose: "商务/资质/报价撰写" },
    { name: "compliance", color: "#ef4444", purpose: "合规审查:对照废标项/资格条件校验" },
  ],
  inputLabel: "粘贴招标文件(RFP)要点 / 评分项 / 废标项…",
  defaultInput:
    "项目:XX 政务云平台采购\n资格:近3年同类业绩≥2;ISO27001;注册资金≥500万\n技术评分:架构30 / 安全合规25 / 实施方案20 / 售后15 / 案例10\n废标项:未提供资质原件扫描件;报价超预算1200万;技术方案缺少等保三级方案",
  orchestrate: async ({ input, ask, setStatus, setResult }) => {
    setStatus("tech-writer / commercial 并行撰写草稿…");
    const [tech, comm] = await Promise.all([
      ask(
        "tech-writer",
        `你是技术方案撰写 tech-writer。根据以下 RFP 撰写「技术方案章节」(总体架构/安全合规/实施方案/售后/案例,并单列等保三级安全建设方案),用 Markdown,要点清晰。\n\nRFP:\n${input}`,
      ),
      ask(
        "commercial",
        `你是商务撰写 commercial。根据以下 RFP 撰写「商务/资质/报价章节」(资格条件逐项响应、报价不超预算、资质清单),用 Markdown。\n\nRFP:\n${input}`,
      ),
    ]);
    setStatus("compliance 对照废标项校验…");
    const comp = await ask(
      "compliance",
      `你是合规审查 compliance。对照下面 RFP 的「资格条件 + 废标项」,逐条校验两份草稿是否满足,输出「缺失项清单 + 整改建议」(Markdown 表格)。\n\nRFP:\n${input}\n\n【技术稿】\n${tech}\n\n【商务稿】\n${comm}`,
    );
    setStatus("bid-lead 编排大纲与废标项自检…");
    const bidLead = await ask(
      "bid-lead",
      `你是投标负责人 bid-lead。请整合下面材料,输出「标书大纲 + 废标项自检表」(Markdown),并在末尾给出投标重点结论。\n\nRFP:\n${input}\n\n【技术稿】\n${tech}\n\n【商务稿】\n${comm}\n\n【合规校验】\n${comp}`,
    );
    // Lossless assembly: bid-lead's outline/self-check frames the document, then
    // the real technical & commercial chapter bodies (verbatim) + compliance.
    setResult(
      [
        "# 投标文件 · 完整版",
        "",
        "## 第一部分 · 标书大纲与废标项自检(bid-lead 整合)",
        "",
        bidLead,
        "",
        "---",
        "",
        "## 第二部分 · 技术方案(正文,tech-writer)",
        "",
        tech,
        "",
        "---",
        "",
        "## 第三部分 · 商务 / 资质 / 报价(正文,commercial)",
        "",
        comm,
        "",
        "---",
        "",
        "## 附 · 合规校验与整改建议(compliance)",
        "",
        comp,
      ].join("\n"),
    );
    setStatus("完成 ✓ — 点「查看完整产出」看装配好的整本标书");
  },
};

const contract: RealScenario = {
  id: "contract",
  title: "合同审查(法务红线)",
  blurb: "intake 提取 → 风险标注 → 红线 → 风险复核 → legal-lead 汇总",
  leadName: "legal-lead",
  agents: [
    { name: "legal-lead", color: "#3b82f6", purpose: "法务负责人:汇总审查意见书 + 谈判要点" },
    { name: "intake", color: "#8b5cf6", purpose: "条款提取:结构化拆分合同条款" },
    { name: "risk-reviewer", color: "#ef4444", purpose: "风险审查:对照 playbook 标风险等级" },
    { name: "redline-drafter", color: "#10b981", purpose: "修订建议:对高风险条款出红线改法" },
  ],
  inputLabel: "粘贴合同文本 / 关键条款…",
  defaultInput:
    "1. 付款:验收后90天内支付,逾期不计利息。\n2. 违约:乙方违约按合同总额30%赔偿,甲方违约无明确责任。\n3. 知识产权:乙方交付成果全部归甲方,含乙方既有底层框架。\n4. 终止:甲方可随时无理由终止且不承担费用。\n5. 保密:无期限、无例外。",
  orchestrate: async ({ input, ask, setStatus, setResult }) => {
    setStatus("intake 提取结构化条款…");
    const clauses = await ask(
      "intake",
      `你是条款提取 intake。把下面合同拆成结构化条款清单(付款/违约/知识产权/终止/保密…),每条标注编号与原文要点,用 Markdown。\n\n合同:\n${input}`,
    );
    setStatus("risk-reviewer 标注风险等级…");
    const risk = await ask(
      "risk-reviewer",
      `你是风险审查 risk-reviewer。对照通用法务 playbook,对下面每条条款标注风险等级(高/中/低)与理由,用 Markdown 表格。\n\n条款:\n${clauses}`,
    );
    setStatus("redline-drafter 起草红线修改…");
    const redline = await ask(
      "redline-drafter",
      `你是修订建议 redline-drafter。针对下面高/中风险条款给出「红线修改建议」(原文 → 建议改法 → 理由),用 Markdown。\n\n风险标注:\n${risk}`,
    );
    setStatus("risk-reviewer 复核红线是否引入新风险…");
    const recheck = await ask(
      "risk-reviewer",
      `你是风险审查 risk-reviewer。复核下面的红线修改建议是否引入新风险或与其他条款冲突,逐条给出复核意见(通过/需调整 + 理由)。\n\n红线建议:\n${redline}`,
    );
    setStatus("legal-lead 汇总审查意见书…");
    const legalLead = await ask(
      "legal-lead",
      `你是法务负责人 legal-lead。请汇总下面材料,输出最终「合同审查意见书 + 谈判要点」(Markdown),按风险优先级排列。\n\n条款:\n${clauses}\n\n风险:\n${risk}\n\n红线:\n${redline}\n\n复核:\n${recheck}`,
    );
    setResult(
      [
        "# 合同审查报告 · 完整版",
        "",
        "## 第一部分 · 审查意见书与谈判要点(legal-lead)",
        "",
        legalLead,
        "",
        "---",
        "",
        "## 第二部分 · 结构化条款(intake)",
        "",
        clauses,
        "",
        "## 第三部分 · 风险标注(risk-reviewer)",
        "",
        risk,
        "",
        "## 第四部分 · 红线修改建议(redline-drafter)",
        "",
        redline,
        "",
        "## 第五部分 · 红线复核(risk-reviewer)",
        "",
        recheck,
      ].join("\n"),
    );
    setStatus("完成 ✓ — 点「查看完整产出」看装配好的审查报告");
  },
};

export const REAL_SCENARIOS: RealScenario[] = [hierarchy, bid, contract];
