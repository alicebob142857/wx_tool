import type {
  EducationTier,
  JobPosition,
  MajorFit,
  PositionRecommendation,
} from "./types.js";
import { stableId } from "./utils.js";

const MAJOR_RANK: Record<MajorFit, number> = {
  administrative_management: 6,
  management: 5,
  humanities: 4,
  broad: 3,
  uncertain: 2,
  mismatch: 1,
};

const EDUCATION_RANK: Record<EducationTier, number> = {
  master: 4,
  bachelor_associate: 3,
  unspecified: 2,
  phd_required: 1,
};

const MAJOR_SCORE: Record<MajorFit, number> = {
  administrative_management: 60,
  management: 52,
  humanities: 44,
  broad: 38,
  uncertain: 22,
  mismatch: 6,
};

const EDUCATION_SCORE: Record<EducationTier, number> = {
  master: 20,
  bachelor_associate: 15,
  unspecified: 9,
  phd_required: 1,
};

function unique(values: string[], limit = 8): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, limit);
}

function fitReason(fit: MajorFit): string {
  switch (fit) {
    case "administrative_management": return "专业高度匹配行政管理";
    case "management": return "专业符合管理类方向";
    case "humanities": return "专业面向文科社科方向";
    case "broad": return "专业限制较宽或不限专业";
    case "uncertain": return "专业范围尚需核对原文";
    case "mismatch": return "专业匹配度较低";
  }
}

function educationReason(tier: EducationTier): string {
  switch (tier) {
    case "master": return "学历要求以硕士为主，符合优先级";
    case "bachelor_associate": return "本科或大专层次可报";
    case "unspecified": return "学历要求未明确，需进一步核实";
    case "phd_required": return "硬性要求博士，按偏好后置";
  }
}

export interface RawPosition extends Omit<JobPosition, "id" | "recommendation"> {
  recommendation: Pick<PositionRecommendation, "reasons" | "concerns">;
  accessibility: number;
}

export function rankPosition(articleUrl: string, raw: RawPosition, index: number): JobPosition {
  const compensationQuality = Math.max(0, Math.min(5, Math.round(raw.compensation.quality || 0)));
  const accessibility = Math.max(0, Math.min(5, Math.round(raw.accessibility || 0)));
  const majorRank = MAJOR_RANK[raw.majors.fit] || MAJOR_RANK.uncertain;
  const educationTier = raw.education.hardPhdRequired ? "phd_required" : raw.education.tier;
  const educationRank = EDUCATION_RANK[educationTier] || EDUCATION_RANK.unspecified;
  const eligibilityBand = raw.education.hardPhdRequired ? 0 : 1;
  const rankingKey = eligibilityBand * 1_000_000 + majorRank * 100_000 + educationRank * 10_000 + compensationQuality * 1_000 + accessibility * 100 + Math.round(raw.confidence * 99);
  let score = Math.max(0, Math.min(100, Math.round(
    (MAJOR_SCORE[raw.majors.fit] || MAJOR_SCORE.uncertain)
      + (EDUCATION_SCORE[educationTier] || EDUCATION_SCORE.unspecified)
      + compensationQuality * 2.4
      + accessibility * 1.6,
  )));
  if (raw.education.hardPhdRequired) score = Math.min(score, 35);
  if (raw.majors.fit === "mismatch") score = Math.min(score, 45);
  const reasons = unique([fitReason(raw.majors.fit), educationReason(educationTier), ...raw.recommendation.reasons], 6);
  const concerns = unique([
    ...(raw.education.hardPhdRequired ? ["硬性博士要求，与你的学历排序偏好不符"] : []),
    ...(raw.majors.fit === "mismatch" ? ["未发现行政管理、管理类或文科专业入口"] : []),
    ...raw.recommendation.concerns,
  ], 6);
  const level: PositionRecommendation["level"] = score >= 76 ? "high" : score >= 52 ? "medium" : "low";
  return {
    ...raw,
    id: stableId(`${articleUrl}|${raw.organization}|${raw.jobTitle}|${index}`),
    education: { ...raw.education, tier: educationTier },
    recommendation: { score, rankingKey, level, reasons, concerns },
  };
}

export function sortPositions<T extends JobPosition>(positions: T[]): T[] {
  return [...positions].sort((a, b) =>
    b.recommendation.rankingKey - a.recommendation.rankingKey
      || b.recommendation.score - a.recommendation.score
      || b.confidence - a.confidence,
  );
}
