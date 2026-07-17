import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Account } from "./types.js";

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
  for (const account of accounts) {
    if (!account.name || !account.fakeid) {
      throw new Error("公众号配置必须包含 name 和 fakeid");
    }
  }
  return accounts;
}
