import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonObject, heuristicClassify } from "../src/deepseek.js";

test("extractJsonObject accepts fenced model output", () => {
  const parsed = extractJsonObject('```json\n{"is_relevant":true,"confidence":0.9}\n```');
  assert.equal(parsed.is_relevant, true);
  assert.equal(parsed.confidence, 0.9);
});

test("heuristic classifier catches broad management recruitment", () => {
  const result = heuristicClassify("总部校园招聘", "招聘人力资源、行政管理岗位，面向2027届毕业生");
  assert.equal(result.isRelevant, true);
  assert.ok(result.suitableMajors.includes("管理"));
});

test("heuristic classifier rejects pure news", () => {
  const result = heuristicClassify("年度工作会议召开", "集团总结科技创新成果");
  assert.equal(result.isRelevant, false);
});

