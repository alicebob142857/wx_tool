import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonObject, heuristicClassify, parseArticleAnalysis } from "../src/deepseek.js";

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

test("position analysis extracts detailed requirements and ranks eligible master role above hard PhD role", () => {
  const payload = JSON.stringify({
    is_recruitment: true,
    summary: "某单位招聘行政与人力岗位",
    extraction_complete: true,
    positions: [
      {
        organization: "甲单位",
        job_title: "行政管理研究岗",
        locations: ["北京"],
        education: { summary: "博士研究生", minimum: "博士", tier: "phd_required", hard_phd_required: true },
        majors: { summary: "行政管理", accepted: ["行政管理"], fit: "administrative_management" },
        application_requirements: ["应届毕业生"],
        compensation: { summary: "事业编制", benefits: ["五险一金"], quality: 4 },
        recommendation_reasons: ["专业高度匹配"],
        non_recommendation_reasons: ["仅限博士"],
        accessibility: 1,
        evidence: ["行政管理专业博士研究生"],
        confidence: 0.95,
      },
      {
        organization: "乙单位",
        organization_nature: "国企",
        industry: "公共服务",
        job_title: "人力资源岗",
        job_directions: ["人力资源"],
        locations: ["上海"],
        graduate_scope: "2027届",
        previous_graduates_eligible: "no",
        education: { summary: "硕士研究生", minimum: "硕士", tier: "master", hard_phd_required: false },
        majors: { summary: "人力资源管理", accepted: ["人力资源管理"], fit: "management" },
        application_requirements: ["2027届"],
        compensation: { summary: "薪资面议", benefits: [], quality: 2 },
        application_url: "https://example.com/apply",
        referral_code: "HR2027",
        recommendation_reasons: ["硕士岗位"],
        non_recommendation_reasons: ["薪资未披露"],
        accessibility: 4,
        evidence: ["人力资源管理专业硕士"],
        confidence: 0.9,
      },
    ],
  });
  const result = parseArticleAnalysis(payload, "https://mp.weixin.qq.com/s/example");
  assert.equal(result.positions.length, 2);
  assert.equal(result.positions[0].jobTitle, "人力资源岗");
  assert.equal(result.positions[0].organizationNature, "国企");
  assert.equal(result.positions[0].previousGraduatesEligible, "no");
  assert.equal(result.positions[0].applicationUrl, "https://example.com/apply");
  assert.equal(result.positions[1].recommendation.level, "low");
  assert.equal(result.positions[1].education.hardPhdRequired, true);
  assert.ok(result.positions[0].recommendation.reasons.length > 0);
  assert.ok(result.positions[0].recommendation.concerns.length > 0);
});
