export interface Account {
  name: string;
  fakeid: string;
  alias?: string;
  note?: string;
  avatarUrl?: string;
  source?: "bootstrap" | "name_search" | "article_url" | "manual";
  status?: "active" | "paused";
  addedAt?: string;
  updatedAt?: string;
}

export interface WechatArticle {
  aid?: string;
  title: string;
  link: string;
  update_time: number;
  create_time?: number;
  author_name?: string;
  digest?: string;
  content?: string;
  is_deleted?: boolean;
}

export interface ParsedArticle {
  title: string;
  text: string;
  imageUrls: string[];
}

export interface Classification {
  isRelevant: boolean;
  summary: string;
  reasons: string[];
  suitableMajors: string[];
  jobTypes: string[];
  locations: string[];
  deadline: string | null;
  graduateScope: string;
  confidence: number;
  source: "deepseek" | "heuristic";
}

export type MajorFit =
  | "administrative_management"
  | "management"
  | "humanities"
  | "broad"
  | "uncertain"
  | "mismatch";

export type EducationTier = "master" | "bachelor_associate" | "unspecified" | "phd_required";
export type PreviousGraduateEligibility = "yes" | "no" | "uncertain";

export interface PositionEducation {
  summary: string;
  minimum: string | null;
  preferred: string | null;
  tier: EducationTier;
  hardPhdRequired: boolean;
}

export interface PositionMajors {
  summary: string;
  accepted: string[];
  fit: MajorFit;
}

export interface PositionCompensation {
  summary: string;
  salary: string | null;
  benefits: string[];
  quality: number;
}

export interface PositionRecommendation {
  score: number;
  rankingKey: number;
  level: "high" | "medium" | "low";
  reasons: string[];
  concerns: string[];
}

export interface PersonalizedGates {
  freshGraduate: boolean;
  education: boolean;
  major: boolean;
  notSocialRecruitment: boolean;
  notInternship: boolean;
  notPhdOnly: boolean;
  notAssociateThreshold: boolean;
  customRequirement: boolean;
}

export interface PersonalizedAssessment {
  eligible: boolean;
  score: number;
  rankingKey: number;
  reasons: string[];
  concerns: string[];
  gates: PersonalizedGates;
}

export type FeedbackReason = "compensation" | "role" | "requirements" | "location";

export interface FeedbackPreferenceSignal {
  dimension: "compensation" | "role" | "requirements" | "location" | "organization" | "other";
  direction: "prefer" | "avoid";
  preference: string;
  strength: 1 | 2 | 3;
  support: number;
}

export interface FeedbackPreferenceProfile {
  summary: string;
  confidence: number;
  evidenceCount: number;
  likeCount: number;
  dislikeCount: number;
  softPreferences: FeedbackPreferenceSignal[];
  caution: string;
  generatedAt: string;
}

export interface FeedbackPreferenceAssessment {
  active: boolean;
  score: number;
  reasons: string[];
  concerns: string[];
}

export interface UserProfile {
  school: string;
  education: string;
  major: string;
  freshGraduate: boolean;
  customRequirement: string;
  considerFeedback: boolean;
  feedbackPreference?: FeedbackPreferenceProfile;
}

export interface CustomRequirementAssessment {
  active: boolean;
  matched: boolean | null;
  score: number;
  reasons: string[];
  concerns: string[];
}

export interface JobPosition {
  id: string;
  organization: string;
  organizationNature: string;
  industry: string;
  jobTitle: string;
  jobDirections: string[];
  locations: string[];
  headcount: string | null;
  employmentTypes: string[];
  graduateScope: string;
  previousGraduatesEligible: PreviousGraduateEligibility;
  education: PositionEducation;
  majors: PositionMajors;
  applicationRequirements: string[];
  compensation: PositionCompensation;
  deadline: string | null;
  applicationMethod: string | null;
  applicationUrl: string | null;
  referralCode: string | null;
  recommendation: PositionRecommendation;
  customRequirement?: CustomRequirementAssessment;
  feedbackPreference?: FeedbackPreferenceAssessment;
  personalized?: PersonalizedAssessment;
  evidence: string[];
  confidence: number;
}

export interface ArticleAnalysis {
  isRecruitment: boolean;
  summary: string;
  positions: JobPosition[];
  source: "deepseek" | "heuristic";
  extractionComplete: boolean;
  notes: string[];
}

export interface ReportItem {
  id: string;
  account: string;
  title: string;
  url: string;
  publishedAt: string;
  ocrUsed: boolean;
  ocrImageCount: number;
  summary: string;
  positions: JobPosition[];
  analysisSource: "deepseek" | "heuristic";
  extractionComplete: boolean;
  notes: string[];
}

export interface RunStats {
  accountsConfigured: number;
  accountsSucceeded: number;
  articlesScanned: number;
  newArticles: number;
  candidateArticles: number;
  relevantArticles: number;
  positionsExtracted: number;
  failedArticles: number;
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  stats: RunStats;
  items: ReportItem[];
  errors: string[];
}

export interface SiteStatus {
  state: "ok" | "partial" | "auth_required" | "error" | "never_run";
  message: string;
  lastRunAt: string | null;
  auth: {
    status: "valid" | "expired" | "unknown";
    expiresAt: string | null;
    qrAvailable: boolean;
  };
  stats: RunStats | null;
}
