import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WritingAccount, WritingStatus } from "./writing-types.js";

export interface WritingSeenFile {
  version: 1;
  urls: Record<string, string>;
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

export async function loadWritingSeen(rootDir: string): Promise<WritingSeenFile> {
  return readJson(path.join(rootDir, "state", "writing-seen.json"), { version: 1, urls: {} });
}

export function hasSeenWriting(seen: WritingSeenFile, url: string): boolean {
  return Boolean(seen.urls[url]);
}

export function markWritingSeen(seen: WritingSeenFile, url: string): void {
  seen.urls[url] = new Date().toISOString();
}

export async function saveWritingSeen(rootDir: string, seen: WritingSeenFile): Promise<void> {
  const cutoff = Date.now() - 365 * 24 * 3_600_000;
  for (const [url, timestamp] of Object.entries(seen.urls)) {
    if (Date.parse(timestamp) < cutoff) delete seen.urls[url];
  }
  await writeJson(path.join(rootDir, "state", "writing-seen.json"), seen);
}

export async function writeWritingStatus(rootDir: string, status: WritingStatus): Promise<void> {
  await writeJson(path.join(rootDir, "site", "writing", "data", "status.json"), status);
}

export async function writeWritingAccounts(rootDir: string, accounts: WritingAccount[]): Promise<void> {
  await writeJson(path.join(rootDir, "site", "writing", "data", "accounts.json"), {
    count: accounts.length,
    accounts,
    updatedAt: new Date().toISOString(),
  });
}
