import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Account, UserProfile } from "./types.js";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} 必须是非负数字`);
  }
  return value;
}

export interface AppConfig {
  rootDir: string;
  exporterBaseUrl: string;
  exporterAuthKey: string;
  authServiceUrl: string;
  authServiceToken: string;
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  lookbackHours: number;
  maxArticlesPerRun: number;
  ocrMaxImages: number;
  ocrTimeoutMs: number;
  ocrArticleBudgetMs: number;
  articleConcurrency: number;
  forceReprocessHours: number;
  classifierMode: "deepseek" | "heuristic";
}

export function loadConfig(): AppConfig {
  const rootDir = process.cwd();
  const classifierMode = process.env.CLASSIFIER_MODE === "heuristic" ? "heuristic" : "deepseek";
  return {
    rootDir,
    exporterBaseUrl: (process.env.WX_EXPORTER_BASE_URL || "https://down.mptext.top").replace(/\/$/, ""),
    exporterAuthKey: process.env.WX_EXPORTER_AUTH_KEY || "",
    authServiceUrl: (process.env.AUTH_SERVICE_URL || "").replace(/\/$/, ""),
    authServiceToken: process.env.AUTH_SERVICE_TOKEN || "",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    lookbackHours: numberEnv("LOOKBACK_HOURS", 36),
    maxArticlesPerRun: numberEnv("MAX_ARTICLES_PER_RUN", 60),
    ocrMaxImages: numberEnv("OCR_MAX_IMAGES", 8),
    ocrTimeoutMs: numberEnv("OCR_TIMEOUT_MS", 60_000),
    ocrArticleBudgetMs: numberEnv("OCR_ARTICLE_BUDGET_MS", 90_000),
    articleConcurrency: numberEnv("ARTICLE_CONCURRENCY", 3),
    forceReprocessHours: numberEnv("FORCE_REPROCESS_HOURS", 0),
    classifierMode,
  };
}

export async function loadAccounts(rootDir: string): Promise<Account[]> {
  const content = await readFile(path.join(rootDir, "config", "accounts.json"), "utf8");
  const accounts = JSON.parse(content) as Account[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("config/accounts.json 中没有公众号配置");
  }
  const names = new Set<string>();
  const fakeids = new Set<string>();
  for (const account of accounts) {
    if (!account.name || !account.fakeid) {
      throw new Error("公众号配置必须包含 name 和 fakeid");
    }
    if (names.has(account.name)) throw new Error(`公众号名称重复：${account.name}`);
    if (fakeids.has(account.fakeid)) throw new Error(`公众号 fakeid 重复：${account.fakeid}`);
    names.add(account.name);
    fakeids.add(account.fakeid);
  }
  return accounts;
}

export async function loadProfile(rootDir: string): Promise<UserProfile> {
  const fallback: UserProfile = {
    school: "北京师范大学",
    education: "硕士研究生",
    major: "行政管理",
    freshGraduate: true,
    customRequirement: "",
  };
  try {
    const content = await readFile(path.join(rootDir, "config", "profile.json"), "utf8");
    const profile = JSON.parse(content) as Partial<UserProfile>;
    return {
      school: String(profile.school || fallback.school).trim(),
      education: String(profile.education || fallback.education).trim(),
      major: String(profile.major || fallback.major).trim(),
      freshGraduate: profile.freshGraduate !== false,
      customRequirement: String(profile.customRequirement || "").trim().slice(0, 2_000),
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}
