import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeWritingCandidate,
  parseWritingArticleHtml,
  splitWritingText,
} from "../src/writing-extractor.js";
import {
  classifyWritingTopic,
  normalizeWritingTopic,
  WRITING_MAJOR_TOPICS,
  WRITING_SUBTOPICS,
} from "../src/writing-topics.js";

test("writing candidate filter accepts model essays and rejects unrelated notices", () => {
  assert.equal(looksLikeWritingCandidate("申论范文：让基层治理更有温度"), true);
  assert.equal(looksLikeWritingCandidate("课程系统答疑通知"), false);
});

test("writing parser keeps paragraphs and account metadata", () => {
  const parsed = parseWritingArticleHtml(`
    <article id="js_article">
      <h1 id="activity-name">申论范文：测试文章</h1>
      <a id="js_name">测试公众号</a>
      <div id="js_content"><p>第一段。</p><p>第二段。</p></div>
    </article>
  `);
  assert.equal(parsed.title, "申论范文：测试文章");
  assert.equal(parsed.accountName, "测试公众号");
  assert.match(parsed.text, /第一段。\n第二段。/);
});

test("writing splitter separates essay, commentary, source note and promotions", () => {
  const body = `关键词：基层治理；民生
让基层治理更有温度
基层治理连接千家万户，是公共服务落地的重要环节。
【王老师解析：第一段先用基层治理的重要性引出全文主题。】
要完善服务体系，及时回应群众急难愁盼的问题。
【王老师点评：第二段提出对策，结构清晰。】
【注】本文根据公开评论文章修改，仅供学习。
如果觉得还有点帮助，请点赞转发。`;
  const result = splitWritingText("申论范文：让基层治理更有温度", body);
  assert.equal(result.essayTitle, "让基层治理更有温度");
  assert.equal(result.commentarySections.length, 2);
  assert.match(result.essayText, /基层治理连接千家万户/);
  assert.doesNotMatch(result.essayText, /王老师|点赞转发/);
  assert.match(result.sourceNote || "", /仅供学习/);
  assert.deepEqual(result.keywords, ["基层治理", "民生"]);
});

test("writing topic classifier uses six stable major directions and controlled subtopics", () => {
  assert.equal(WRITING_MAJOR_TOPICS.length, 6);
  assert.equal(new Set(Object.values(WRITING_SUBTOPICS).flat()).size, 24);
  assert.ok(Object.values(WRITING_SUBTOPICS).every(topics => topics.length === 4));
  assert.deepEqual(classifyWritingTopic({
    title: "以AI智变激活干部教育新动能",
    theme: "人工智能、干部教育",
  }), { majorTopic: "科技", subtopic: "人工智能" });
  assert.deepEqual(classifyWritingTopic({
    title: "走好社区服务惠民路",
    theme: "社区、惠民、基层治理",
  }), { majorTopic: "社会", subtopic: "城乡治理" });
  assert.deepEqual(normalizeWritingTopic("政治", "自造的过细标签", {
    title: "将实事求是落到实处",
  }), { majorTopic: "政治", subtopic: "理论作风" });
});
