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

export interface ReportItem extends Classification {
  id: string;
  account: string;
  title: string;
  url: string;
  publishedAt: string;
  ocrUsed: boolean;
  ocrImageCount: number;
}

export interface RunStats {
  accountsConfigured: number;
  accountsSucceeded: number;
  articlesScanned: number;
  newArticles: number;
  candidateArticles: number;
  relevantArticles: number;
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

