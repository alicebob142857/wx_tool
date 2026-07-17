import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeJobPost, parseArticleHtml } from "../src/article-parser.js";

test("parseArticleHtml extracts WeChat text and lazy-loaded images", () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="某集团校园招聘"></head><body>
    <div id="js_article"><div id="js_content" style="visibility:hidden">
      <p>面向经济学、工商管理和法学专业毕业生招聘。</p>
      <img data-src="https://mmbiz.qpic.cn/example/640?wx_fmt=png&amp;from=appmsg">
    </div></div></body></html>`;
  const parsed = parseArticleHtml(html);
  assert.equal(parsed.title, "某集团校园招聘");
  assert.match(parsed.text, /工商管理/);
  assert.deepEqual(parsed.imageUrls, ["https://mmbiz.qpic.cn/example/640?wx_fmt=png&from=appmsg"]);
});

test("looksLikeJobPost uses inclusive recruitment hints", () => {
  assert.equal(looksLikeJobPost("2027届校园招聘提前批开启"), true);
  assert.equal(looksLikeJobPost("公司召开年度工作会议"), false);
});

