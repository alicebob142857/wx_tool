import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { generateFeedbackPreference, type FeedbackTrainingRecord } from "../src/feedback-preference.js";

const config: AppConfig = {
  rootDir: process.cwd(),
  exporterBaseUrl: "",
  exporterAuthKey: "",
  authServiceUrl: "",
  authServiceToken: "",
  deepseekApiKey: "",
  deepseekModel: "deepseek-chat",
  deepseekBaseUrl: "https://api.deepseek.com",
  lookbackHours: 36,
  maxArticlesPerRun: 60,
  ocrMaxImages: 12,
  ocrTimeoutMs: 60_000,
  ocrArticleBudgetMs: 90_000,
  articleConcurrency: 3,
  forceReprocessHours: 0,
  classifierMode: "deepseek",
};

function feedback(positionId: string, sentiment: "like" | "dislike"): FeedbackTrainingRecord {
  return {
    positionId,
    sentiment,
    reasons: sentiment === "dislike" ? ["location"] : [],
    updatedAt: "2026-07-22T00:00:00.000Z",
    job: { jobTitle: "综合行政岗", organization: "测试单位", locations: ["北京"] },
  };
}

test("feedback preference stays neutral when fewer than three signals exist", async () => {
  const result = await generateFeedbackPreference(config, [feedback("a", "like"), feedback("b", "dislike")]);
  assert.equal(result.evidenceCount, 2);
  assert.equal(result.softPreferences.length, 0);
  assert.ok(result.confidence <= 0.1);
  assert.match(result.caution, /不改变.*硬条件/);
});

test("feedback preference has a neutral no-feedback baseline", async () => {
  const result = await generateFeedbackPreference(config, []);
  assert.equal(result.evidenceCount, 0);
  assert.equal(result.likeCount, 0);
  assert.equal(result.dislikeCount, 0);
  assert.equal(result.softPreferences.length, 0);
});
