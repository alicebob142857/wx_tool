export const WRITING_MAJOR_TOPICS = ["政治", "经济", "社会", "文化", "生态", "科技"] as const;

export type WritingMajorTopic = typeof WRITING_MAJOR_TOPICS[number];

export const WRITING_SUBTOPICS: Record<WritingMajorTopic, readonly string[]> = {
  政治: ["理论作风", "改革法治", "干部担当", "党建引领"],
  经济: ["产业发展", "营商环境", "就业人才", "乡村振兴"],
  社会: ["城乡治理", "公共服务", "民生保障", "教育成长"],
  文化: ["文化传承", "文明建设", "文旅融合", "文艺传播"],
  生态: ["绿色低碳", "环境治理", "生态保护", "美丽中国"],
  科技: ["人工智能", "数字治理", "科技创新", "产业升级"],
};

export interface WritingTopic {
  majorTopic: WritingMajorTopic;
  subtopic: string;
}

const TOPIC_RULES: Array<WritingTopic & { keywords: string[] }> = [
  { majorTopic: "科技", subtopic: "人工智能", keywords: ["人工智能", "AI", "智能化", "大模型", "算法"] },
  { majorTopic: "科技", subtopic: "数字治理", keywords: ["数字治理", "数字政府", "数字化治理", "智慧城市", "数字赋能", "数据要素", "大数据", "数据资源", "网络安全", "数据安全", "信息安全", "个人信息"] },
  { majorTopic: "科技", subtopic: "产业升级", keywords: ["新质生产力", "智能制造", "产业升级", "科技产业"] },
  { majorTopic: "科技", subtopic: "科技创新", keywords: ["科技创新", "技术创新", "创新驱动", "科研", "科创"] },

  { majorTopic: "生态", subtopic: "绿色低碳", keywords: ["双碳", "低碳", "碳达峰", "碳中和", "减排", "绿色发展", "绿色转型", "绿色产业", "循环经济"] },
  { majorTopic: "生态", subtopic: "环境治理", keywords: ["污染防治", "环境治理", "垃圾分类", "水环境", "大气治理"] },
  { majorTopic: "生态", subtopic: "生态保护", keywords: ["生态保护", "生物多样性", "自然保护", "山水林田湖草"] },
  { majorTopic: "生态", subtopic: "美丽中国", keywords: ["美丽中国", "美丽乡村", "生态文明"] },

  { majorTopic: "文化", subtopic: "文旅融合", keywords: ["文旅融合", "农文旅", "文化旅游", "旅游发展", "乡村旅游"] },
  { majorTopic: "文化", subtopic: "文化传承", keywords: ["文化传承", "传统文化", "非遗", "文化遗产", "历史文化", "文化自信", "文化强国", "中华文化", "文化软实力"] },
  { majorTopic: "文化", subtopic: "文明建设", keywords: ["文明建设", "文明城市", "文明实践", "社会文明"] },
  { majorTopic: "文化", subtopic: "文艺传播", keywords: ["文艺", "文学", "影视", "文化传播", "网络文艺"] },

  { majorTopic: "经济", subtopic: "营商环境", keywords: ["营商环境", "政企服务", "市场主体", "企业服务"] },
  { majorTopic: "经济", subtopic: "就业人才", keywords: ["就业优先", "人才发展", "人才引进", "稳就业", "技能人才"] },
  { majorTopic: "经济", subtopic: "乡村振兴", keywords: ["乡村振兴", "三农", "农业发展", "农村经济", "共同富裕", "城乡融合"] },
  { majorTopic: "经济", subtopic: "产业发展", keywords: ["产业发展", "实体经济", "民营经济", "经济发展", "产业链", "区域协调", "区域发展", "城市群", "扩大内需", "消费", "市场活力"] },

  { majorTopic: "政治", subtopic: "理论作风", keywords: ["实事求是", "理论学习", "作风建设", "调查研究", "求真务实"] },
  { majorTopic: "政治", subtopic: "改革法治", keywords: ["深化改革", "改革创新", "首创精神", "体制机制", "破立并举", "依法行政", "法治建设", "法治政府", "执法", "普法"] },
  { majorTopic: "政治", subtopic: "干部担当", keywords: ["干部担当", "担当作为", "干事创业", "向前一步", "履职尽责"] },
  { majorTopic: "政治", subtopic: "党建引领", keywords: ["党建引领", "党群服务", "基层党建", "党组织", "党员"] },

  { majorTopic: "社会", subtopic: "城乡治理", keywords: ["基层治理", "治理能力", "群众路线", "共建共治", "治理体系", "社区服务", "社区工作", "人民城市", "城市治理", "城市更新", "乡村治理"] },
  { majorTopic: "社会", subtopic: "教育成长", keywords: ["教育发展", "干部教育", "职业教育", "学校教育", "教育公平", "青年成长", "青春", "青年干部", "青年人才", "大学生"] },
  { majorTopic: "社会", subtopic: "民生保障", keywords: ["民生保障", "养老", "医疗", "社会保障", "困难群众"] },
  { majorTopic: "社会", subtopic: "公共服务", keywords: ["公共服务", "政务服务", "为民服务", "惠民服务", "便民服务", "服务群众", "服务供给", "基本公共"] },
];

export function isWritingMajorTopic(value: unknown): value is WritingMajorTopic {
  return WRITING_MAJOR_TOPICS.includes(String(value) as WritingMajorTopic);
}

export function isWritingSubtopic(majorTopic: WritingMajorTopic, value: unknown): boolean {
  return WRITING_SUBTOPICS[majorTopic].includes(String(value));
}

export function classifyWritingTopic(input: {
  title?: string;
  theme?: string;
  keywords?: string[];
  summary?: string;
  text?: string;
}): WritingTopic {
  const title = String(input.title || "").toLocaleLowerCase();
  const theme = [input.theme, ...(input.keywords || [])].filter(Boolean).join("\n").toLocaleLowerCase();
  const body = [input.summary, input.text?.slice(0, 2_000)].filter(Boolean).join("\n").toLocaleLowerCase();
  let best = TOPIC_RULES[TOPIC_RULES.length - 1];
  let bestScore = 0;
  for (const rule of TOPIC_RULES) {
    const score = rule.keywords.reduce((total, keyword) => {
      const normalized = keyword.toLocaleLowerCase();
      const specificity = Math.max(1, Math.min(4, keyword.length / 2));
      if (title.includes(normalized)) return total + specificity + 4;
      if (theme.includes(normalized)) return total + specificity + 2;
      if (body.includes(normalized)) return total + specificity;
      return total;
    }, 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return { majorTopic: best.majorTopic, subtopic: best.subtopic };
}

export function normalizeWritingTopic(
  majorTopic: unknown,
  subtopic: unknown,
  fallbackInput: Parameters<typeof classifyWritingTopic>[0],
): WritingTopic {
  if (isWritingMajorTopic(majorTopic) && isWritingSubtopic(majorTopic, subtopic)) {
    return { majorTopic, subtopic: String(subtopic) };
  }
  return classifyWritingTopic(fallbackInput);
}
