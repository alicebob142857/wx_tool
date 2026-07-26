import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWritingTopic } from "../src/writing-topics.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(rootDir, "site", "data", "runtime.json");
const outputPath = path.join(rootDir, "site", "writing", "data", "entries.json");
const detailDir = path.join(rootDir, "site", "writing", "data", "entries");

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
    entries.push(...batch);
    offset += batch.length;
    if (!batch.length) break;
  } while (offset < total);

  const normalizedEntries = entries.map((entry: any) => ({
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
  }));

  await rm(detailDir, { recursive: true, force: true });
  await mkdir(detailDir, { recursive: true });
  let detailCursor = 0;
  await Promise.all(Array.from({ length: Math.min(20, normalizedEntries.length) }, async () => {
    while (detailCursor < normalizedEntries.length) {
      const entry = normalizedEntries[detailCursor++];
      await writeFile(
        path.join(detailDir, `${entry.id}.json`),
        `${JSON.stringify({ schemaVersion: 1, entry })}\n`,
        "utf8",
      );
    }
  }));

  const indexEntries = normalizedEntries.map((entry: any) => {
    const {
      essayText: _essayText,
      commentaryText: _commentaryText,
      commentarySections: _commentarySections,
      ...summary
    } = entry;
    return {
      ...summary,
      detailPath: `data/entries/${entry.id}.json`,
    };
  });
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    total: indexEntries.length,
    entries: indexEntries,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`WRITING_SNAPSHOT=${indexEntries.length} details=${normalizedEntries.length}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
