import type {
  EducationTier,
  JobPosition,
  MajorFit,
  PersonalizedAssessment,
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

export interface RawPosition extends Omit<JobPosition, "id" | "recommendation" | "personalized"> {
  recommendation: Pick<PositionRecommendation, "reasons" | "concerns">;
  accessibility: number;
}

function includesAny(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function assessPersonalized(position: JobPosition): PersonalizedAssessment {
  const educationText = [
    position.education.summary,
    position.education.minimum,
    position.education.preferred,
  ].filter(Boolean).join("；");
  const majorText = [position.majors.summary, ...(position.majors.accepted || [])].filter(Boolean).join("；");
  const eligibilityText = [
    position.jobTitle,
    ...(position.employmentTypes || []),
    position.graduateScope,
    ...(position.applicationRequirements || []),
    ...(position.evidence || []),
  ].filter(Boolean).join("；");
  const employmentText = (position.employmentTypes || []).join("；");

  const freshGraduate = includesAny(
    eligibilityText,
    /应届|届毕业生|校园招聘|校招|秋招|春招|提前批|高校毕业生|毕业年度|管培生|无工作经历|毕业生岗位/,
  );
  const socialRecruitment = includesAny(employmentText || eligibilityText, /社招|社会招聘|社会人员|成熟人才/);
  const campusRecruitment = includesAny(employmentText || eligibilityText, /校招|校园招聘|应届|届毕业生|秋招|春招|提前批/);
  const internship = includesAny(employmentText || position.jobTitle, /实习|见习/);
  const notSocialRecruitment = !socialRecruitment || campusRecruitment;
  const notInternship = !internship;

  const notPhdOnly = !position.education.hardPhdRequired && position.education.tier !== "phd_required";
  const associateMentioned = includesAny(educationText, /大专|专科/);
  const notAssociateThreshold = !associateMentioned;
  const bachelorOrMaster = position.education.tier === "master"
    || includesAny(educationText, /硕士|研究生|本科|学士/);
  const education = notPhdOnly && notAssociateThreshold && bachelorOrMaster;

  const exactAdministrative = position.majors.fit === "administrative_management"
    || includesAny(majorText, /行政管理|公共管理类|公共管理专业|管理学门类|管理类专业/);
  const unrestricted = position.majors.fit === "broad"
    && includesAny(majorText, /不限专业|专业不限|不限学科|专业不设限制/);
  const major = exactAdministrative || unrestricted;
  const customRequirement = !position.customRequirement?.active
    || position.customRequirement.matched === true;
  const feedbackPreferenceActive = Boolean(position.feedbackPreference?.active);
  const feedbackPreferenceScore = feedbackPreferenceActive
    ? Math.max(0, Math.min(10, Number(position.feedbackPreference?.score || 0)))
    : 5;

  const gates = {
    freshGraduate,
    education,
    major,
    notSocialRecruitment,
    notInternship,
    notPhdOnly,
    notAssociateThreshold,
    customRequirement,
  };
  const eligible = Object.values(gates).every(Boolean);

  const reasons = unique([
    ...(exactAdministrative ? [includesAny(majorText, /行政管理/) ? "专业要求明确覆盖行政管理" : "专业要求覆盖公共管理或管理学门类"] : []),
    ...(unrestricted ? ["专业不限，行政管理可以报考"] : []),
    ...(freshGraduate ? ["明确面向应届毕业生或校园招聘"] : []),
    ...(position.education.tier === "master" || includesAny(educationText, /硕士|研究生/)
      ? ["学历要求覆盖硕士研究生"]
      : bachelorOrMaster ? ["学历门槛为本科，可用硕士学历报考"] : []),
    ...(position.compensation.quality >= 4 ? ["薪资福利信息较有吸引力"] : []),
    ...(position.applicationUrl ? ["报名入口明确，投递可操作性较高"] : []),
    ...(position.customRequirement?.active ? position.customRequirement.reasons : []),
    ...(feedbackPreferenceActive && feedbackPreferenceScore >= 7
      ? (position.feedbackPreference?.reasons || []).slice(0, 2)
      : []),
    ...(position.recommendation.reasons || []).slice(0, 2),
  ], 6);
  const concerns = unique([
    ...(!freshGraduate ? ["未明确面向应届毕业生或校招"] : []),
    ...(!notSocialRecruitment ? ["属于社会招聘，不符合应届求职目标"] : []),
    ...(!notInternship ? ["属于实习或见习岗位，不进入正式优质岗位推荐"] : []),
    ...(!notPhdOnly ? ["硬性要求博士，硕士不能报考"] : []),
    ...(!notAssociateThreshold ? ["学历门槛包含大专或专科，不符合优质岗位标准"] : []),
    ...(notPhdOnly && notAssociateThreshold && !bachelorOrMaster ? ["未能确认岗位接受本科或硕士学历"] : []),
    ...(!major ? ["专业要求未明确覆盖行政管理、公共管理类或不限专业"] : []),
    ...(!customRequirement ? [
      position.customRequirement?.matched === false
        ? "不符合已保存的自定义重要要求"
        : "自定义重要要求缺少足够证据，暂不进入优质推荐",
    ] : []),
    ...(position.customRequirement?.active ? position.customRequirement.concerns : []),
    ...(feedbackPreferenceActive && feedbackPreferenceScore <= 3
      ? (position.feedbackPreference?.concerns || []).slice(0, 2)
      : []),
    ...(!position.deadline ? ["截止日期未披露，需尽快核对原文"] : []),
    ...(position.recommendation.concerns || []).slice(0, 2),
  ], 7);

  let score = 0;
  if (exactAdministrative) score += includesAny(majorText, /行政管理/) ? 42 : 36;
  else if (unrestricted) score += 28;
  if (position.education.tier === "master" || includesAny(educationText, /硕士|研究生/)) score += 25;
  else if (bachelorOrMaster) score += 18;
  if (freshGraduate) score += 14;
  if (/党政机关|事业单位|央企|国企|高校/.test(position.organizationNature || "")) score += 5;
  score += Math.min(6, Math.max(0, Number(position.compensation.quality || 0) * 1.2));
  score += Math.min(5, Math.max(0, Number(position.recommendation.score || 0) / 20));
  if (position.applicationUrl) score += 2;
  if (position.customRequirement?.active) score += Math.max(0, Math.min(15, position.customRequirement.score * 1.5));
  // Learned feedback is deliberately soft: it can move a job by at most 8 points,
  // and it never participates in the eligibility gates above.
  if (feedbackPreferenceActive) score += Math.max(-8, Math.min(8, (feedbackPreferenceScore - 5) * 1.5));
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!eligible) score = Math.min(score, 59);
  const hardGateBand = (notPhdOnly ? 500_000_000 : 0)
    + (notSocialRecruitment ? 200_000_000 : 0)
    + (notAssociateThreshold ? 100_000_000 : 0)
    + (notInternship ? 50_000_000 : 0);
  const rankingKey = (eligible ? 2_000_000_000 : hardGateBand)
    + score * 100_000
    + Math.min(999_999, Math.max(0, Number(position.recommendation.rankingKey || 0)));

  return { eligible, score, rankingKey, reasons, concerns, gates };
}

export function personalizePosition<T extends JobPosition>(position: T): T {
  return { ...position, personalized: assessPersonalized(position) };
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
  const position: JobPosition = {
    ...raw,
    id: stableId(`${articleUrl}|${raw.organization}|${raw.jobTitle}|${index}`),
    education: { ...raw.education, tier: educationTier },
    recommendation: { score, rankingKey, level, reasons, concerns },
  };
  return personalizePosition(position);
}

export function sortPositions<T extends JobPosition>(positions: T[]): T[] {
  return positions.map(position => personalizePosition(position)).sort((a, b) =>
    (b.personalized?.rankingKey || 0) - (a.personalized?.rankingKey || 0)
      || b.recommendation.rankingKey - a.recommendation.rankingKey
      || b.recommendation.score - a.recommendation.score
      || b.confidence - a.confidence,
  );
}
