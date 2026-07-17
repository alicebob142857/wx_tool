import type { AppConfig } from "./config.js";
import type { Classification } from "./types.js";

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

