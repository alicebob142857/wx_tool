export interface Account {
  name: string;
  fakeid: string;
  alias?: string;
  note?: string;
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

export interface JobPosition {
  id: string;
  organization: string;
  jobTitle: string;
  locations: string[];
  headcount: string | null;
  employmentTypes: string[];
  education: PositionEducation;
  majors: PositionMajors;
  applicationRequirements: string[];
  compensation: PositionCompensation;
  deadline: string | null;
  applicationMethod: string | null;
  recommendation: PositionRecommendation;
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
