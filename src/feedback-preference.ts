import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { extractJsonObject } from "./deepseek.js";
import type {
  FeedbackPreferenceProfile,
  FeedbackPreferenceSignal,
  FeedbackReason,
} from "./types.js";

export interface FeedbackTrainingRecord {
  positionId: string;
  sentiment: "like" | "dislike";
  reasons: FeedbackReason[];
  updatedAt: string;
  job: Record<string, any>;
}

const DIMENSIONS = new Set<FeedbackPreferenceSignal["dimension"]>([
  "compensation", "role", "requirements", "location", "organization", "other",
]);

const REASON_LABELS: Record<FeedbackReason, string> = {
  compensation: "待遇",
  role: "岗位",
  requirements: "要求",
  location: "地区",
};

function clamp(value: unknown, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function emptyProfile(feedback: FeedbackTrainingRecord[], now = new Date()): FeedbackPreferenceProfile {
  const likeCount = feedback.filter(item => item.sentiment === "like").length;
  const dislikeCount = feedback.length - likeCount;
  return {
    summary: feedback.length
      ? `目前只有 ${feedback.length} 条赞踩，样本不足，暂不据此调整岗位排序。`
      : "尚无赞踩记录，暂未生成额外偏好。",
    confidence: feedback.length ? 0.1 : 0,
    evidenceCount: feedback.length,
    likeCount,
    dislikeCount,
    softPreferences: [],
    caution: "反馈偏好只用于小幅排序，不改变应届、学历和专业硬条件。",
    generatedAt: now.toISOString(),
  };
}

function compactJob(job: Record<string, any>): Record<string, unknown> {
  return {
    organization: job?.organization || "",
    organizationNature: job?.organizationNature || "",
    jobTitle: job?.jobTitle || "",
    jobDirections: job?.jobDirections || [],
    locations: job?.locations || [],
    education: job?.education?.summary || "",
    majors: job?.majors?.summary || "",
    requirements: (job?.applicationRequirements || []).slice(0, 6),
    salary: job?.compensation?.salary || "",
    benefits: (job?.compensation?.benefits || []).slice(0, 6),
  };
}

async function requestDeepSeekJson(
  config: AppConfig,
  system: string,
  user: string,
  maxTokens = 2_000,
): Promise<any> {
  const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`DeepSeek 偏好分析失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  const raw = payload?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek 偏好分析返回为空");
  return extractJsonObject(raw);
}

export async function generateFeedbackPreference(
  config: AppConfig,
  feedback: FeedbackTrainingRecord[],
  now = new Date(),
): Promise<FeedbackPreferenceProfile> {
  const neutral = emptyProfile(feedback, now);
  if (feedback.length < 3 || !config.deepseekApiKey) return neutral;

  const input = feedback.slice(0, 120).map(item => ({
    sentiment: item.sentiment,
    dislikeReasons: item.reasons.map(reason => REASON_LABELS[reason]),
    job: compactJob(item.job || {}),
  }));
  const result = await requestDeepSeekJson(
    config,
    `你是谨慎的求职偏好分析员。根据用户对岗位的赞和踩，总结可用于下一轮排序的弱偏好。

必须保守：
1. 一条反馈不能形成偏好；同一倾向至少需要 2 条相互支持的反馈。
2. 点踩所选原因只说明对应维度不满意，不能推断其他维度。
3. 赞表示整体感兴趣，但不能凭一次赞推断绝对条件。
4. 反馈冲突时降低置信度或不输出该偏好。
5. strength 通常为 1；至少 4 条一致证据才可为 2；至少 8 条高度一致证据才可为 3。
6. 不得生成“绝不考虑”“一律排除”等硬限制。应届、学历和专业硬条件由其他规则负责。

只返回 JSON：{"summary":"一句简洁总结","confidence":0.0,"soft_preferences":[{"dimension":"compensation|role|requirements|location|organization|other","direction":"prefer|avoid","preference":"具体但非绝对的偏好","strength":1,"support":2}],"caution":"一句防止过拟合的提醒"}`,
    JSON.stringify(input),
  );

  const softPreferences: FeedbackPreferenceSignal[] = [];
  for (const raw of Array.isArray(result?.soft_preferences) ? result.soft_preferences : []) {
    const dimension = String(raw?.dimension || "other") as FeedbackPreferenceSignal["dimension"];
    const direction = raw?.direction === "avoid" ? "avoid" : "prefer";
    const preference = String(raw?.preference || "").trim().slice(0, 160);
    const support = Math.floor(clamp(raw?.support, 0, feedback.length));
    if (!DIMENSIONS.has(dimension) || !preference || support < 2) continue;
    const requestedStrength = Math.round(clamp(raw?.strength, 1, 3));
    const maximumStrength = support >= 8 ? 3 : support >= 4 ? 2 : 1;
    softPreferences.push({
      dimension,
      direction,
      preference,
      strength: Math.min(requestedStrength, maximumStrength) as 1 | 2 | 3,
      support,
    });
  }
  const likeCount = feedback.filter(item => item.sentiment === "like").length;
  const confidence = softPreferences.length ? clamp(result?.confidence, 0.15, 0.75) : 0.1;
  return {
    summary: softPreferences.length
      ? String(result?.summary || "已从多条反馈中提取少量弱偏好。").trim().slice(0, 300)
      : `已有 ${feedback.length} 条反馈，但倾向尚不一致，暂不调整排序。`,
    confidence,
    evidenceCount: feedback.length,
    likeCount,
    dislikeCount: feedback.length - likeCount,
    softPreferences: softPreferences.slice(0, 6),
    caution: String(result?.caution || neutral.caution).trim().slice(0, 240),
    generatedAt: now.toISOString(),
  };
}

function deadlineTimestamp(deadline: string | null, now: Date): number | null {
  if (!deadline) return null;
  const normalized = deadline.replace(/[./]/g, "-");
  const full = normalized.match(/(20\d{2})\s*(?:年|-)?\s*(\d{1,2})\s*(?:月|-)?\s*(\d{1,2})\s*日?/);
  if (full) return Date.parse(`${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}T23:59:59+08:00`);
  const short = deadline.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!short) return null;
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now));
  return Date.parse(`${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}T23:59:59+08:00`);
}

export async function rerankHistoricalQualityPool(
  config: AppConfig,
  profile: FeedbackPreferenceProfile | undefined,
): Promise<boolean> {
  if (!config.deepseekApiKey || !profile?.softPreferences.length) return false;
  const historyPath = path.join(config.rootDir, "site", "data", "job-history.json");
  const poolPath = path.join(config.rootDir, "site", "data", "quality-pool.json");
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const now = history.generatedAt ? new Date(history.generatedAt) : new Date();
  const unique = new Map<string, any>();
  for (const job of Array.isArray(history?.jobs) ? history.jobs : []) {
    if (!job?.id || !job?.personalized?.eligible) continue;
    const expiry = deadlineTimestamp(job.deadline, now);
    if (expiry !== null && expiry < now.getTime()) continue;
    if (!unique.has(job.id)) unique.set(job.id, job);
  }
  const candidates = [...unique.values()].sort((a, b) =>
    Number(b.personalized?.rankingKey || 0) - Number(a.personalized?.rankingKey || 0)
      || Date.parse(b.article?.publishedAt || 0) - Date.parse(a.article?.publishedAt || 0),
  ).slice(0, 45);
  if (!candidates.length) return false;

  const result = await requestDeepSeekJson(
    config,
    `你是保守的历史优质岗位排序助手。所有输入岗位已经通过应届、学历和专业硬条件。只根据给定的赞踩弱偏好，对每个岗位给出 0-10 契合分，5 为中性。证据不足必须给 5；不得因为弱偏好排除岗位；理由必须基于岗位字段。只返回 JSON：{"assessments":[{"id":"岗位ID","score":5,"reasons":[],"concerns":[]}]}`,
    JSON.stringify({ preference: profile, jobs: candidates.map(job => ({ id: job.id, ...compactJob(job) })) }),
    4_000,
  );
  const assessments = new Map<string, any>();
  for (const item of Array.isArray(result?.assessments) ? result.assessments : []) {
    if (!unique.has(String(item?.id || ""))) continue;
    assessments.set(String(item.id), {
      active: true,
      score: Math.round(clamp(item?.score, 0, 10)),
      reasons: Array.isArray(item?.reasons) ? item.reasons.map(String).filter(Boolean).slice(0, 3) : [],
      concerns: Array.isArray(item?.concerns) ? item.concerns.map(String).filter(Boolean).slice(0, 3) : [],
    });
  }
  const ranked = candidates.map(job => {
    const assessment = assessments.get(job.id) || { active: true, score: 5, reasons: [], concerns: [] };
    const base = Number(job.personalized?.rankingKey || 0);
    return { job: { ...job, feedbackPreference: assessment }, ranking: base + (assessment.score - 5) * 50_000 };
  }).sort((a, b) => b.ranking - a.ranking
    || Date.parse(b.job.article?.publishedAt || 0) - Date.parse(a.job.article?.publishedAt || 0));
  const jobs = ranked.slice(0, 30).map(item => item.job);
  await writeFile(poolPath, `${JSON.stringify({
    generatedAt: history.generatedAt || new Date().toISOString(),
    maxSize: 30,
    total: jobs.length,
    feedbackPreferenceApplied: true,
    jobs,
  }, null, 2)}\n`, "utf8");
  return true;
}
