import type { AppConfig } from "./config.js";
import type {
  ArticleAnalysis,
  Classification,
  EducationTier,
  MajorFit,
  PreviousGraduateEligibility,
  UserProfile,
} from "./types.js";
import { rankPosition, sortPositions, type RawPosition } from "./recommendation.js";

const HUMANITIES_MANAGEMENT = [
  "管理",
  "工商",
  "行政",
  "公共管理",
  "人力资源",
  "市场营销",
  "经济",
  "金融",
  "会计",
  "财务",
  "审计",
  "法学",
  "法律",
  "中文",
  "汉语言",
  "新闻",
  "传播",
  "外语",
  "英语",
  "国际贸易",
  "社会学",
  "教育",
  "哲学",
  "历史",
  "政治",
  "不限专业",
  "专业不限",
  "文科",
];

export function extractJsonObject(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型没有返回有效 JSON");
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, 12);
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function clampFive(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(5, Math.round(number)));
}

function clampTen(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(10, Math.round(number)));
}

function nullableString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function majorFit(value: unknown): MajorFit {
  const allowed: MajorFit[] = ["administrative_management", "management", "humanities", "broad", "uncertain", "mismatch"];
  return allowed.includes(value as MajorFit) ? value as MajorFit : "uncertain";
}

function educationTier(value: unknown, hardPhdRequired: boolean): EducationTier {
  if (hardPhdRequired) return "phd_required";
  const allowed: EducationTier[] = ["master", "bachelor_associate", "unspecified", "phd_required"];
  return allowed.includes(value as EducationTier) ? value as EducationTier : "unspecified";
}

function previousGraduateEligibility(value: unknown): PreviousGraduateEligibility {
  const allowed: PreviousGraduateEligibility[] = ["yes", "no", "uncertain"];
  return allowed.includes(value as PreviousGraduateEligibility) ? value as PreviousGraduateEligibility : "uncertain";
}

function parsePosition(raw: any, articleUrl: string, index: number): ReturnType<typeof rankPosition> | null {
  const jobTitle = String(raw?.job_title || "").trim();
  if (!jobTitle) return null;
  const hardPhdRequired = Boolean(raw?.education?.hard_phd_required);
  const position: RawPosition = {
    organization: String(raw?.organization || "未明确单位").trim(),
    organizationNature: String(raw?.organization_nature || "未披露").trim(),
    industry: String(raw?.industry || "未披露").trim(),
    jobTitle,
    jobDirections: stringArray(raw?.job_directions),
    locations: stringArray(raw?.locations),
    headcount: nullableString(raw?.headcount),
    employmentTypes: stringArray(raw?.employment_types),
    graduateScope: String(raw?.graduate_scope || "未明确").trim(),
    previousGraduatesEligible: previousGraduateEligibility(raw?.previous_graduates_eligible),
    education: {
      summary: String(raw?.education?.summary || "未明确").trim(),
      minimum: nullableString(raw?.education?.minimum),
      preferred: nullableString(raw?.education?.preferred),
      tier: educationTier(raw?.education?.tier, hardPhdRequired),
      hardPhdRequired,
    },
    majors: {
      summary: String(raw?.majors?.summary || "未明确").trim(),
      accepted: stringArray(raw?.majors?.accepted),
      fit: majorFit(raw?.majors?.fit),
    },
    applicationRequirements: stringArray(raw?.application_requirements),
    compensation: {
      summary: String(raw?.compensation?.summary || "未披露").trim(),
      salary: nullableString(raw?.compensation?.salary),
      benefits: stringArray(raw?.compensation?.benefits),
      quality: clampFive(raw?.compensation?.quality),
    },
    deadline: nullableString(raw?.deadline),
    applicationMethod: nullableString(raw?.application_method),
    applicationUrl: nullableString(raw?.application_url),
    referralCode: nullableString(raw?.referral_code),
    recommendation: {
      reasons: stringArray(raw?.recommendation_reasons),
      concerns: stringArray(raw?.non_recommendation_reasons),
    },
    customRequirement: {
      active: Boolean(raw?.custom_requirement?.active),
      matched: typeof raw?.custom_requirement?.matched === "boolean" ? raw.custom_requirement.matched : null,
      score: clampTen(raw?.custom_requirement?.score),
      reasons: stringArray(raw?.custom_requirement?.reasons),
      concerns: stringArray(raw?.custom_requirement?.concerns),
    },
    accessibility: clampFive(raw?.accessibility),
    evidence: stringArray(raw?.evidence),
    confidence: clampConfidence(raw?.confidence),
  };
  return rankPosition(articleUrl, position, index);
}

export function parseArticleAnalysis(raw: string, articleUrl: string): ArticleAnalysis {
  const result = extractJsonObject(raw);
  const positions = Array.isArray(result?.positions)
    ? result.positions.map((position: any, index: number) => parsePosition(position, articleUrl, index)).filter(Boolean)
    : [];
  return {
    isRecruitment: Boolean(result?.is_recruitment) && positions.length > 0,
    summary: String(result?.summary || "").trim(),
    positions: sortPositions(positions as ArticleAnalysis["positions"]),
    source: "deepseek",
    extractionComplete: result?.extraction_complete !== false,
    notes: stringArray(result?.notes),
  };
}

export function heuristicAnalyzeArticle(title: string, text: string, articleUrl: string): ArticleAnalysis {
  const classification = heuristicClassify(title, text);
  if (!classification.isRelevant) {
    return { isRecruitment: false, summary: classification.summary, positions: [], source: "heuristic", extractionComplete: false, notes: ["DeepSeek 不可用，规则仅能完成文章级判断"] };
  }
  const combined = `${title}\n${text}`;
  const fit: MajorFit = /行政管理/.test(combined)
    ? "administrative_management"
    : /管理|工商|人力资源|市场营销/.test(combined)
      ? "management"
      : /法学|中文|新闻|传播|外语|经济|金融|会计|文科/.test(combined)
        ? "humanities"
        : /不限专业|专业不限/.test(combined) ? "broad" : "uncertain";
  const hardPhdRequired = /博士(研究生)?[^。；\n]{0,8}(及以上|学历|学位)|仅限博士/.test(combined);
  const tier: EducationTier = hardPhdRequired
    ? "phd_required"
    : /硕士|研究生/.test(combined) ? "master" : /本科|大专|专科/.test(combined) ? "bachelor_associate" : "unspecified";
  const raw: RawPosition = {
    organization: "详见原文",
    organizationNature: "未披露",
    industry: "未披露",
    jobTitle: title,
    jobDirections: [],
    locations: [],
    headcount: null,
    employmentTypes: classification.jobTypes,
    graduateScope: classification.graduateScope,
    previousGraduatesEligible: "uncertain",
    education: { summary: tier === "unspecified" ? "未明确" : tier, minimum: null, preferred: null, tier, hardPhdRequired },
    majors: { summary: classification.suitableMajors.join("、") || "需核对原文", accepted: classification.suitableMajors, fit },
    applicationRequirements: [],
    compensation: { summary: "未完成模型提取", salary: null, benefits: [], quality: 0 },
    deadline: classification.deadline,
    applicationMethod: null,
    applicationUrl: null,
    referralCode: null,
    recommendation: { reasons: classification.reasons, concerns: ["当前为规则降级结果，岗位细节需 DeepSeek 重新分析"] },
    customRequirement: { active: false, matched: null, score: 0, reasons: [], concerns: [] },
    accessibility: 2,
    evidence: [],
    confidence: classification.confidence,
  };
  return {
    isRecruitment: true,
    summary: classification.summary,
    positions: [rankPosition(articleUrl, raw, 0)],
    source: "heuristic",
    extractionComplete: false,
    notes: ["DeepSeek 不可用，暂以文章标题作为岗位组展示"],
  };
}

export async function analyzeArticle(
  config: AppConfig,
  title: string,
  articleUrl: string,
  articleText: string,
  ocrText: string,
  profile?: UserProfile,
): Promise<ArticleAnalysis> {
  const combined = `${articleText}\n${ocrText}`;
  if (config.classifierMode === "heuristic" || !config.deepseekApiKey) {
    return heuristicAnalyzeArticle(title, combined, articleUrl);
  }

  const userProfile = profile || {
    school: "北京师范大学",
    education: "硕士研究生",
    major: "行政管理",
    freshGraduate: true,
    customRequirement: "",
  };
  const customRequirement = userProfile.customRequirement.trim();
  const input = `求职者画像：${userProfile.school}，${userProfile.education}，${userProfile.major}专业，${userProfile.freshGraduate ? "具有应届毕业生身份" : "不限定应届身份"}。\n自定义重要要求：${customRequirement || "无"}\n\n文章标题：${title}\n文章链接：${articleUrl}\n\n网页正文：\n${articleText.slice(0, 24_000)}\n\n图片 OCR：\n${ocrText.slice(0, 30_000)}`;
  const system = `你是严谨的中国高校毕业生招聘岗位分析员。请从一篇公众号文章中提取每一个可以区分的招聘岗位；同一名称但要求不同的岗位要拆分，完全相同要求的岗位可合并为岗位组。不要把活动报道、求职课程或宣传内容当成岗位。

求职者是北京师范大学行政管理专业硕士，并具有应届毕业生身份。优质岗位的硬条件是：明确面向应届毕业生/校园招聘；学历接受本科或硕士且门槛不含大专/专科；不能只招博士；专业明确接受行政管理、公共管理类/管理学门类，或明确不限专业；社会招聘、实习见习不算优质岗位。

推荐优先级必须严格遵循：
1. 专业匹配最重要：明确行政管理最高，其次公共管理类或管理学门类，再其次不限专业。仅招人力资源管理、工商管理、会计等其他管理专业但未覆盖行政管理时，不得判断为适合。
2. 学历第二重要：明确面向硕士优先，本科及以上其次；含大专/专科门槛、学历不明、硬性博士要求均明显降级。
3. 应届/校招优先；社招、要求成熟工作经验、实习见习后置。
4. 再比较薪资、福利、单位性质、地点、截止日期和报考门槛。薪资未披露时不要臆测。
5. 如果用户提供了自定义重要要求，必须逐岗位判断是否满足；只有原文明确支持时 matched 才为 true，明确冲突为 false，证据不足为 null。该要求对排序有较高权重，但不能放宽上述专业、学历和应届硬条件。

对每个岗位详细但简洁地提取：岗位、岗位方向、单位、企业性质、行业、地点、人数、招聘类型、适用届别、往届生能否投递、学历要求、专业要求、全部硬性报考条件、薪资、福利、截止时间、报名方式、网申地址和内推码。企业性质可使用央企、国企、事业单位、党政机关、高校、民企、外企、社会组织等原文可支持的类别。网申地址必须来自原文中的真实 URL，不要编造。每个岗位分别给出 2-4 条推荐理由和 1-4 条不推荐/风险理由。理由只能基于原文；信息缺失要写“未披露”或放入风险。

如果文章包含大量岗位，同一单位、学历和专业要求相同的岗位必须合并成岗位组，并把具体方向放入 job_directions；positions 最多 30 项。所有数组字段只保留最重要的 8 项，避免输出被截断，但不得省略学历、专业、报名和待遇的关键限制。

枚举要求：majors.fit 只能是 administrative_management、management、humanities、broad、uncertain、mismatch；education.tier 只能是 master、bachelor_associate、unspecified、phd_required；previous_graduates_eligible 只能是 yes、no、uncertain。compensation.quality 和 accessibility 为 0-5 整数。hard_phd_required 只有硬性博士起报时才为 true。custom_requirement.active 在用户自定义要求非空时为 true；score 为 0-10 整数；matched 只能是 true、false 或 null。

只返回 JSON，不要 Markdown：
{"is_recruitment":true,"summary":"文章一句话摘要","extraction_complete":true,"notes":[],"positions":[{"organization":"单位","organization_nature":"央企","industry":"公共服务","job_title":"岗位","job_directions":["综合行政"],"locations":["地点"],"headcount":null,"employment_types":["校招"],"graduate_scope":"2027届","previous_graduates_eligible":"no","education":{"summary":"详细学历要求","minimum":"本科","preferred":"硕士","tier":"master","hard_phd_required":false},"majors":{"summary":"详细专业要求","accepted":["行政管理"],"fit":"administrative_management"},"application_requirements":["年龄、证书、经历、政治面貌等硬性条件"],"compensation":{"summary":"薪酬福利概述","salary":"具体薪资或null","benefits":["六险二金"],"quality":4},"deadline":null,"application_method":null,"application_url":null,"referral_code":null,"recommendation_reasons":["理由"],"non_recommendation_reasons":["风险"],"custom_requirement":{"active":${customRequirement ? "true" : "false"},"matched":null,"score":0,"reasons":[],"concerns":[]},"accessibility":4,"evidence":["支持判断的短句"],"confidence":0.9}]}`;

  const requestAnalysis = async (retryInstruction = ""): Promise<string> => {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.deepseekApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.deepseekModel,
        temperature: retryInstruction ? 0 : 0.05,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}${retryInstruction}` },
          { role: "user", content: input },
        ],
      }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）：${body.slice(0, 180)}`);
    }
    const payload: any = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("DeepSeek 返回内容为空");
    return raw;
  };

  const first = await requestAnalysis();
  try {
    return parseArticleAnalysis(first, articleUrl);
  } catch {
    const retry = await requestAnalysis("\n\n上一次响应因 JSON 过长或格式错误而无法解析。请重新完整输出合法 JSON，强制合并相同条件岗位组，positions 不超过 20 项，每个数组不超过 6 项，不要输出任何额外文字。");
    return parseArticleAnalysis(retry, articleUrl);
  }
}

export function heuristicClassify(title: string, text: string): Classification {
  const combined = `${title}\n${text}`;
  const majorHits = HUMANITIES_MANAGEMENT.filter(keyword => combined.includes(keyword));
  const recruiting = /招聘|校招|社招|招录|岗位|实习|聘用|秋招|春招|提前批/.test(combined);
  const broadEligibility = /不限专业|专业不限|管理类|经济类|法学类|文学类|文科/.test(combined);
  const isRelevant = recruiting && (majorHits.length > 0 || broadEligibility);
  return {
    isRelevant,
    summary: isRelevant ? "检测到招聘信息及文科/管理类相关专业或不限专业条件。" : "未检测到明确的文科或管理类招聘条件。",
    reasons: majorHits.length ? [`命中专业关键词：${majorHits.slice(0, 8).join("、")}`] : [],
    suitableMajors: majorHits.slice(0, 8),
    jobTypes: [...new Set(combined.match(/校招|社招|实习|秋招|春招|提前批/g) || [])],
    locations: [],
    deadline: null,
    graduateScope: /2027届/.test(combined) ? "2027届" : /2026届/.test(combined) ? "2026届" : "未明确",
    confidence: isRelevant ? 0.58 : 0.4,
    source: "heuristic",
  };
}

export async function classifyArticle(
  config: AppConfig,
  title: string,
  articleText: string,
  ocrText: string,
): Promise<Classification> {
  if (config.classifierMode === "heuristic" || !config.deepseekApiKey) {
    return heuristicClassify(title, `${articleText}\n${ocrText}`);
  }

  const input = `标题：${title}\n\n网页正文：\n${articleText.slice(0, 18_000)}\n\n图片OCR：\n${ocrText.slice(0, 18_000)}`;
  const system = `你是中国高校毕业生招聘信息审核员。判断文章中是否存在适合文科或管理类毕业生申请的明确岗位/招聘项目。
文科管理类包括但不限于：经济、金融、会计、财务、审计、工商管理、公共管理、行政、人力资源、市场营销、法学、中文、新闻传播、外语、国际贸易、社会学、教育、哲学、历史、政治等；“专业不限”也算相关。
纯宣传报道、培训广告、求职经验、没有岗位的活动，以及只招聘理工科岗位的文章不算。
只返回 JSON，不要 markdown：
{"is_relevant":true,"summary":"一句话摘要","reasons":["依据"],"suitable_majors":["专业"],"job_types":["校招/社招/实习"],"locations":["地点"],"deadline":null,"graduate_scope":"适用届别","confidence":0.0}`;

  const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）：${body.slice(0, 180)}`);
  }
  const payload: any = await response.json();
  const raw = payload?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek 返回内容为空");
  const result = extractJsonObject(raw);
  return {
    isRelevant: Boolean(result.is_relevant),
    summary: String(result.summary || "").trim(),
    reasons: stringArray(result.reasons),
    suitableMajors: stringArray(result.suitable_majors),
    jobTypes: stringArray(result.job_types),
    locations: stringArray(result.locations),
    deadline: result.deadline ? String(result.deadline) : null,
    graduateScope: String(result.graduate_scope || "未明确"),
    confidence: clampConfidence(result.confidence),
    source: "deepseek",
  };
}
