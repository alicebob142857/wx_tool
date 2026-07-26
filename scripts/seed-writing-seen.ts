import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface WritingSeenFile {
  version: 1;
  urls: Record<string, string>;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(rootDir, "site", "data", "runtime.json");
const seenPath = path.join(rootDir, "state", "writing-seen.json");

function canonicalArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "mp.weixin.qq.com" && /^\/s\/[^/]+/.test(url.pathname)) {
      return `${url.origin}${url.pathname}`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (!["__biz", "mid", "idx", "sn"].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

async function resolveApiUrl(): Promise<string> {
  if (process.env.WRITING_API_URL) return process.env.WRITING_API_URL.replace(/\/$/, "");
  if (process.env.AUTH_SERVICE_URL) return process.env.AUTH_SERVICE_URL.replace(/\/$/, "");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  if (!runtime?.authServiceUrl) throw new Error("缺少 WRITING_API_URL 或 AUTH_SERVICE_URL");
  return String(runtime.authServiceUrl).replace(/\/$/, "");
}

async function loadSeen(): Promise<WritingSeenFile> {
  try {
    const parsed = JSON.parse(await readFile(seenPath, "utf8")) as Partial<WritingSeenFile>;
    return {
      version: 1,
      urls: parsed.urls && typeof parsed.urls === "object" ? parsed.urls : {},
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { version: 1, urls: {} };
    throw error;
  }
}

async function main(): Promise<void> {
  const apiUrl = await resolveApiUrl();
  const seen = await loadSeen();
  const now = new Date().toISOString();
  const limit = 1_000;
  let offset = 0;
  let total = 0;
  let added = 0;

  do {
    const response = await fetch(`${apiUrl}/api/writing-entries?limit=${limit}&offset=${offset}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`范文断点读取失败（HTTP ${response.status}）`);
    const page: any = await response.json();
    total = Number(page.total || 0);
    const entries = Array.isArray(page.entries) ? page.entries : [];
    for (const entry of entries) {
      const articleUrl = canonicalArticleUrl(String(entry?.articleUrl || ""));
      if (!articleUrl || seen.urls[articleUrl]) continue;
      seen.urls[articleUrl] = now;
      added += 1;
    }
    offset += entries.length;
    if (!entries.length) break;
  } while (offset < total);

  await mkdir(path.dirname(seenPath), { recursive: true });
  await writeFile(seenPath, `${JSON.stringify(seen, null, 2)}\n`, "utf8");
  console.log(`WRITING_SEEN_SEEDED total=${total} added=${added} state=${Object.keys(seen.urls).length}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
