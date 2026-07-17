import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DailyReport, SiteStatus } from "./types.js";

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

export async function writeDailyReport(rootDir: string, report: DailyReport): Promise<void> {
  const dataDir = path.join(rootDir, "site", "data");
  await writeJson(path.join(dataDir, "daily", `${report.date}.json`), report);
  const indexFile = path.join(dataDir, "index.json");
  const index = await readJson<{ generatedAt: string | null; days: IndexEntry[] }>(indexFile, {
    generatedAt: null,
    days: [],
  });
  const entry: IndexEntry = {
    date: report.date,
    generatedAt: report.generatedAt,
    relevantCount: report.stats.relevantArticles,
    articlesScanned: report.stats.articlesScanned,
    accountsSucceeded: report.stats.accountsSucceeded,
  };
  index.days = [entry, ...index.days.filter(day => day.date !== report.date)].slice(0, 365);
  index.generatedAt = report.generatedAt;
  await writeJson(indexFile, index);
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

