import assert from "node:assert/strict";
import test from "node:test";
import { rankPosition, type RawPosition } from "../src/recommendation.js";

function position(overrides: Partial<RawPosition> = {}) {
  const base: RawPosition = {
    organization: "测试单位",
    organizationNature: "事业单位",
    industry: "公共服务",
    jobTitle: "综合行政岗",
    jobDirections: ["综合行政"],
    locations: ["北京"],
    headcount: "1人",
    employmentTypes: ["校园招聘"],
    graduateScope: "2027届应届毕业生",
    previousGraduatesEligible: "no",
    education: { summary: "本科及以上，硕士优先", minimum: "本科", preferred: "硕士", tier: "master", hardPhdRequired: false },
    majors: { summary: "行政管理、公共管理类", accepted: ["行政管理", "公共管理类"], fit: "administrative_management" },
    applicationRequirements: ["2027届应届毕业生"],
    compensation: { summary: "五险二金", salary: null, benefits: ["五险二金"], quality: 4 },
    deadline: "2027年6月30日",
    applicationMethod: "网申",
    applicationUrl: "https://example.com/apply",
    referralCode: null,
    recommendation: { reasons: ["专业匹配"], concerns: [] },
    customRequirement: { active: false, matched: null, score: 0, reasons: [], concerns: [] },
    accessibility: 4,
    evidence: ["面向2027届毕业生招聘行政管理专业"],
    confidence: 0.95,
  };
  return rankPosition("https://mp.weixin.qq.com/s/test", { ...base, ...overrides }, 0);
}

test("personalized filter accepts fresh administrative bachelor or master jobs", () => {
  const result = position();
  assert.equal(result.personalized?.eligible, true);
  assert.ok((result.personalized?.score || 0) >= 80);
});

test("personalized filter rejects social, associate-threshold, PhD-only and unrelated management jobs", () => {
  const social = position({ employmentTypes: ["社会招聘"], graduateScope: "社会人员", applicationRequirements: ["3年工作经验"] });
  const associate = position({ education: { summary: "大专及以上", minimum: "大专", preferred: null, tier: "bachelor_associate", hardPhdRequired: false } });
  const phd = position({ education: { summary: "博士研究生", minimum: "博士", preferred: null, tier: "phd_required", hardPhdRequired: true } });
  const humanResources = position({ majors: { summary: "仅限人力资源管理", accepted: ["人力资源管理"], fit: "management" } });
  assert.equal(social.personalized?.eligible, false);
  assert.equal(associate.personalized?.eligible, false);
  assert.equal(phd.personalized?.eligible, false);
  assert.equal(humanResources.personalized?.eligible, false);
});

test("custom important requirement is a ranking gate when active", () => {
  const mismatch = position({
    customRequirement: { active: true, matched: false, score: 1, reasons: [], concerns: ["地点不符合要求"] },
  });
  const match = position({
    customRequirement: { active: true, matched: true, score: 10, reasons: ["地点符合要求"], concerns: [] },
  });
  assert.equal(mismatch.personalized?.eligible, false);
  assert.equal(match.personalized?.eligible, true);
  assert.ok((match.personalized?.score || 0) > (mismatch.personalized?.score || 0));
});
