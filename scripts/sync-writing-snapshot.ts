import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWritingTopic } from "../src/writing-topics.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(rootDir, "site", "data", "runtime.json");
const outputPath = path.join(rootDir, "site", "writing", "data", "entries.json");

async function resolveApiUrl(): Promise<string> {
  if (process.env.AUTH_SERVICE_URL) return process.env.AUTH_SERVICE_URL.replace(/\/$/, "");
  if (process.env.WRITING_API_URL) return process.env.WRITING_API_URL.replace(/\/$/, "");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  if (!runtime?.authServiceUrl) throw new Error("缺少 AUTH_SERVICE_URL");
  return String(runtime.authServiceUrl).replace(/\/$/, "");
}

async function main(): Promise<void> {
  const apiUrl = await resolveApiUrl();
  const entries: any[] = [];
  let offset = 0;
  const limit = 100;
  let total = 0;
  do {
    const response = await fetch(`${apiUrl}/api/writing-entries?limit=${limit}&offset=${offset}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`范文快照读取失败（HTTP ${response.status}）`);
    const page: any = await response.json();
    total = Number(page.total || 0);
    const batch = Array.isArray(page.entries) ? page.entries : [];
    entries.push(...batch.map((entry: any) => ({
      ...entry,
      ...normalizeWritingTopic(entry.majorTopic, entry.subtopic, {
        title: entry.essayTitle || entry.articleTitle,
        theme: entry.theme,
        keywords: entry.keywords,
        summary: entry.summary,
        text: entry.essayText,
      }),
      favorite: false,
      favoritedAt: null,
    })));
    offset += batch.length;
    if (!batch.length) break;
  } while (offset < total);

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`WRITING_SNAPSHOT=${entries.length}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
