import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Account, DailyReport, ReportItem, SiteStatus } from "./types.js";
import { sortPositions } from "./recommendation.js";
import { buildStaticHistory } from "./static-history.js";

interface SeenFile {
  version: 1;
  urls: Record<string, string>;
}

interface IndexEntry {
  date: string;
  generatedAt: string;
  relevantCount: number;
  articlesScanned: number;
  accountsSucceeded: number;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadSeen(rootDir: string): Promise<SeenFile> {
  return readJson(path.join(rootDir, "state", "seen.json"), { version: 1, urls: {} });
}

export function hasSeen(seen: SeenFile, url: string): boolean {
  return Boolean(seen.urls[url]);
}

export function markSeen(seen: SeenFile, url: string, timestamp = new Date().toISOString()): void {
  seen.urls[url] = timestamp;
}

export async function saveSeen(rootDir: string, seen: SeenFile): Promise<void> {
  const cutoff = Date.now() - 180 * 24 * 3_600_000;
  for (const [url, timestamp] of Object.entries(seen.urls)) {
    if (Date.parse(timestamp) < cutoff) delete seen.urls[url];
  }
  await writeJson(path.join(rootDir, "state", "seen.json"), seen);
}

function mergeItems(existing: ReportItem[], current: ReportItem[], replaceItemIds: string[]): ReportItem[] {
  const replaced = new Set(replaceItemIds);
  const byId = new Map(existing.filter(item => !replaced.has(item.id)).map(item => [item.id, item]));
  for (const item of current) byId.set(item.id, { ...item, positions: sortPositions(item.positions || []) });
  return [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export async function writeDailyReport(
  rootDir: string,
  report: DailyReport,
  replaceItemIds: string[] = [],
): Promise<DailyReport> {
  const dataDir = path.join(rootDir, "site", "data");
  const dailyFile = path.join(dataDir, "daily", `${report.date}.json`);
  const existing = await readJson<DailyReport | null>(dailyFile, null);
  const mergedItems = mergeItems(existing?.items || [], report.items, replaceItemIds);
  const merged: DailyReport = {
    ...report,
    stats: {
      ...report.stats,
      newArticles: Math.max(existing?.stats?.newArticles || 0, report.stats.newArticles),
      candidateArticles: Math.max(existing?.stats?.candidateArticles || 0, report.stats.candidateArticles),
      relevantArticles: mergedItems.length,
      positionsExtracted: mergedItems.reduce((sum, item) => sum + (item.positions?.length || 0), 0),
    },
    items: mergedItems,
    errors: [...new Set([...(existing?.errors || []), ...report.errors])].slice(-100),
  };
  await writeJson(dailyFile, merged);
  const indexFile = path.join(dataDir, "index.json");
  const index = await readJson<{ generatedAt: string | null; days: IndexEntry[] }>(indexFile, {
    generatedAt: null,
    days: [],
  });
  const entry: IndexEntry = {
    date: report.date,
    generatedAt: report.generatedAt,
    relevantCount: merged.stats.positionsExtracted,
    articlesScanned: merged.stats.articlesScanned,
    accountsSucceeded: merged.stats.accountsSucceeded,
  };
  index.days = [entry, ...index.days.filter(day => day.date !== report.date)].slice(0, 365);
  index.generatedAt = merged.generatedAt;
  await writeJson(indexFile, index);
  await buildStaticHistory(rootDir);
  return merged;
}

export async function writeStatus(rootDir: string, status: SiteStatus): Promise<void> {
  await writeJson(path.join(rootDir, "site", "data", "status.json"), status);
}

export async function writeRuntimeConfig(rootDir: string, authServiceUrl: string): Promise<void> {
  await writeJson(path.join(rootDir, "site", "data", "runtime.json"), {
    authServiceUrl,
    updatedAt: new Date().toISOString(),
  });
}

export async function writeAccountsSnapshot(rootDir: string, accounts: Account[]): Promise<void> {
  await writeJson(path.join(rootDir, "site", "data", "accounts.json"), {
    count: accounts.length,
    accounts,
    updatedAt: new Date().toISOString(),
  });
}
