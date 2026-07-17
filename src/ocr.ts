import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeWhitespace } from "./utils.js";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function extensionFor(contentType: string | null): string {
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";
  return ".jpg";
}

async function ocrOne(
  url: string,
  directory: string,
  index: number,
  timeoutMs: number,
  deadline: number,
): Promise<string> {
  const downloadBudget = Math.min(15_000, timeoutMs, Math.max(1_000, deadline - Date.now()));
  const response = await fetch(url, {
    headers: { Referer: "https://mp.weixin.qq.com/" },
    signal: AbortSignal.timeout(downloadBudget),
  });
  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("图片超过 15MB，已跳过");
  const file = path.join(directory, `${index}${extensionFor(response.headers.get("content-type"))}`);
  await writeFile(file, buffer);
  const recognitionBudget = Math.min(timeoutMs, Math.max(1_000, deadline - Date.now()));
  const { stdout } = await execFileAsync(
    "tesseract",
    [file, "stdout", "-l", "chi_sim+eng", "--psm", "6"],
    { timeout: recognitionBudget, maxBuffer: 8 * 1024 * 1024 },
  );
  return normalizeWhitespace(stdout);
}

export interface OcrResult {
  text: string;
  processed: number;
  errors: string[];
}

export async function ocrImages(
  urls: string[],
  maxImages: number,
  timeoutMs: number,
  articleBudgetMs = 90_000,
  concurrency = 3,
): Promise<OcrResult> {
  if (maxImages <= 0 || urls.length === 0) return { text: "", processed: 0, errors: [] };
  const directory = await mkdtemp(path.join(os.tmpdir(), "wx-ocr-"));
  const selected = urls.slice(0, maxImages);
  const chunks: string[] = new Array(selected.length).fill("");
  const errors: string[] = [];
  let processed = 0;
  let cursor = 0;
  const deadline = Date.now() + Math.max(5_000, articleBudgetMs);
  try {
    const worker = async () => {
      while (cursor < selected.length) {
        if (Date.now() >= deadline - 1_000) break;
        const index = cursor++;
        try {
          chunks[index] = await ocrOne(selected[index], directory, index, timeoutMs, deadline);
          processed += 1;
        } catch (error) {
          errors.push(`第 ${index + 1} 张图片 OCR 失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), selected.length) }, worker));
    if (cursor < selected.length) {
      errors.push(`达到单篇 OCR 时间预算，跳过 ${selected.length - cursor} 张图片`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return { text: chunks.filter(Boolean).join("\n\n"), processed, errors };
}
