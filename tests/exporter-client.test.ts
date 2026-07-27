import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { ExporterClient } from "../src/exporter-client.js";

const config: AppConfig = {
  rootDir: process.cwd(),
  exporterBaseUrl: "",
  exporterAuthKey: "",
  authServiceUrl: "https://worker.example",
  authServiceToken: "test-token",
  deepseekApiKey: "",
  deepseekModel: "deepseek-v4-flash",
  deepseekBaseUrl: "https://api.deepseek.com",
  lookbackHours: 36,
  maxArticlesPerRun: 60,
  ocrMaxImages: 12,
  ocrTimeoutMs: 60_000,
  ocrArticleBudgetMs: 90_000,
  articleConcurrency: 3,
  forceReprocessHours: 0,
  classifierMode: "deepseek",
  writingLookbackHours: 72,
  writingMaxArticlesPerRun: 20,
  writingArticleConcurrency: 2,
  writingHistoryMaxPages: 200,
  writingFullHistory: true,
};

test("full-history article listing paginates, deduplicates, and stops at the end", async () => {
  const originalFetch = globalThis.fetch;
  const begins: number[] = [];
  globalThis.fetch = (async input => {
    const url = new URL(String(input));
    const begin = Number(url.searchParams.get("begin"));
    begins.push(begin);
    const article = (suffix: string, updateTime: number) => ({
      title: `申论范文 ${suffix}`,
      link: `https://mp.weixin.qq.com/s/${suffix}`,
      update_time: updateTime,
    });
    const pages: Record<number, any[]> = {
      0: [article("a", 3), article("b", 2)],
      20: [article("b", 2), article("c", 1)],
      40: [],
    };
    return new Response(JSON.stringify({
      base_resp: { ret: 0 },
      articles: pages[begin] || [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const client = new ExporterClient(config);
    const articles = await client.listArticles(
      { name: "测试公众号", fakeid: "fake-id" },
      config.writingHistoryMaxPages,
    );
    assert.deepEqual(begins, [0, 20, 40]);
    assert.deepEqual(articles.map(article => article.link), [
      "https://mp.weixin.qq.com/s/a",
      "https://mp.weixin.qq.com/s/b",
      "https://mp.weixin.qq.com/s/c",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("large writing reports are uploaded in bounded batches", async () => {
  const originalFetch = globalThis.fetch;
  const batchSizes: number[] = [];
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body || "{}"));
    batchSizes.push(payload.entries.length);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new ExporterClient(config);
    await client.saveWritingReport({
      date: "2026-07-26",
      generatedAt: "2026-07-26T00:00:00.000Z",
      stats: {
        accountsConfigured: 1,
        accountsSucceeded: 1,
        articlesScanned: 120,
        newArticles: 120,
        candidateArticles: 120,
        examplesStored: 120,
        failedArticles: 0,
      },
      entries: Array.from({ length: 120 }, (_, index) => ({ id: String(index) })) as any,
      errors: [],
    });
    assert.deepEqual(batchSizes, [50, 50, 20]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("article download falls back to the original WeChat page after a proxy 502", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("https://worker.example/api/exporter/content")) {
      return new Response("Bad gateway", { status: 502 });
    }
    return new Response(
      "<html><head><meta property=\"og:title\" content=\"申论范文\"></head>"
      + "<body><div id=\"js_content\">正文</div></body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  }) as typeof fetch;

  try {
    const client = new ExporterClient(config);
    const html = await client.downloadArticleHtml("https://mp.weixin.qq.com/s/fallback");
    assert.match(html, /id="js_content"/);
    assert.equal(requested.length, 2);
    assert.equal(requested[1], "https://mp.weixin.qq.com/s/fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
