export interface WritingAccount {
  fakeid: string;
  name: string;
  alias?: string;
  avatarUrl?: string;
  seedArticleUrl?: string;
  seedPublishedAt?: string;
  status?: "active" | "paused";
  addedAt?: string;
  updatedAt?: string;
}

export interface WritingCommentarySection {
  sectionTitle: string;
  commentary: string;
}

export interface WritingEntry {
  id: string;
  account: string;
  accountFakeid: string;
  articleTitle: string;
  articleUrl: string;
  publishedAt: string;
  collectedAt: string;
  essayTitle: string;
  theme: string;
  keywords: string[];
  summary: string;
  essayText: string;
  commentarySections: WritingCommentarySection[];
  commentaryText: string;
  sourceNote: string | null;
  wordCount: number;
  analysisSource: "deepseek" | "heuristic";
  confidence: number;
}

export interface WritingRunStats {
  accountsConfigured: number;
  accountsSucceeded: number;
  articlesScanned: number;
  newArticles: number;
  candidateArticles: number;
  examplesStored: number;
  failedArticles: number;
}

export interface WritingReport {
  date: string;
  generatedAt: string;
  stats: WritingRunStats;
  entries: WritingEntry[];
  errors: string[];
}

export interface WritingStatus {
  state: "ok" | "partial" | "auth_required" | "error" | "never_run";
  message: string;
  lastRunAt: string | null;
  stats: WritingRunStats | null;
}
