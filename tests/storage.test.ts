import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeDailyReport } from "../src/storage.js";
import type { DailyReport, ReportItem } from "../src/types.js";

function report(items: ReportItem[]): DailyReport {
  return {
    date: "2026-07-17",
    generatedAt: "2026-07-17T02:00:00.000Z",
    stats: {
      accountsConfigured: 10,
      accountsSucceeded: 10,
      articlesScanned: 2,
      newArticles: 2,
      candidateArticles: 2,
      relevantArticles: items.length,
      positionsExtracted: 0,
      failedArticles: 0,
    },
    items,
    errors: [],
  };
}

function item(id: string): ReportItem {
  return {
    id,
    account: "测试公众号",
    title: `文章 ${id}`,
    url: `https://mp.weixin.qq.com/s/${id}`,
    publishedAt: "2026-07-17T01:00:00.000Z",
    ocrUsed: false,
    ocrImageCount: 0,
    summary: "旧的启发式结果",
    positions: [],
    analysisSource: "heuristic",
    extractionComplete: false,
    notes: [],
  };
}

test("writeDailyReport removes stale items only for successfully reprocessed articles", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "wx-tool-storage-"));
  try {
    await writeDailyReport(rootDir, report([item("reprocessed"), item("fetch-failed")]));
    const merged = await writeDailyReport(rootDir, report([]), ["reprocessed"]);

    assert.deepEqual(merged.items.map(value => value.id), ["fetch-failed"]);
    assert.equal(merged.stats.relevantArticles, 1);
    const history = JSON.parse(await readFile(path.join(rootDir, "site/data/job-history.json"), "utf8"));
    const accounts = JSON.parse(await readFile(path.join(rootDir, "site/data/accounts.json"), "utf8"));
    const csv = await readFile(path.join(rootDir, "site/data/jobs.csv"), "utf8");
    assert.equal(history.total, 0);
    assert.equal(accounts.count, 0);
    assert.match(csv, /^\uFEFF"公众号","更新日期"/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
