import { fetchAndParseArticle, looksLikeJobPost } from "../src/article-parser.js";
import { loadAccounts, loadConfig } from "../src/config.js";
import { heuristicClassify } from "../src/deepseek.js";
import { ExporterClient } from "../src/exporter-client.js";
import { ocrImages } from "../src/ocr.js";

const config = loadConfig();
const accounts = await loadAccounts(config.rootDir);
const client = new ExporterClient(config);
const auth = await client.checkAuth();
if (!auth.valid) throw new Error("微信授权无效，无法执行真实冒烟测试");

const account = accounts[0];
const articles = await client.listArticles(account);
const candidates = articles.filter(item => item.link && !item.is_deleted && looksLikeJobPost(`${item.title}\n${item.content || ""}`));
if (!candidates.length) throw new Error(`${account.name} 最新一页没有找到招聘候选文章`);
let article = candidates[0];
let parsed = null;
const parseErrors: string[] = [];
for (const candidate of candidates.slice(0, 8)) {
  try {
    const value = await fetchAndParseArticle(candidate, url => client.downloadArticleHtml(url));
    article = candidate;
    parsed = value;
    break;
  } catch (error) {
    parseErrors.push(`${candidate.title}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (!parsed) throw new Error(`前 ${Math.min(8, candidates.length)} 篇候选文章均无法解析：${parseErrors.join("；")}`);
const ocr = await ocrImages(parsed.imageUrls, Math.min(1, config.ocrMaxImages), config.ocrTimeoutMs);
const classification = heuristicClassify(parsed.title, `${parsed.text}\n${ocr.text}`);

const imageArticle = {
  title: "天府绛溪实验室2026年第二批招聘公告",
  link: "https://mp.weixin.qq.com/s/nxqnl6EpHkMBa8S9f9y8ig",
  update_time: 1784202463,
};
const imageParsed = await fetchAndParseArticle(imageArticle, url => client.downloadArticleHtml(url));
const imageOcr = await ocrImages(imageParsed.imageUrls, Math.min(1, config.ocrMaxImages), config.ocrTimeoutMs);

console.log(JSON.stringify({
  authValid: true,
  account: account.name,
  fetchedArticles: articles.length,
  sampleTitle: parsed.title,
  textCharacters: parsed.text.length,
  imageCount: parsed.imageUrls.length,
  ocrCharacters: ocr.text.length,
  heuristicRelevant: classification.isRelevant,
  imageSample: {
    title: imageParsed.title,
    textCharacters: imageParsed.text.length,
    imageCount: imageParsed.imageUrls.length,
    firstImageOcrCharacters: imageOcr.text.length,
    containsJobDemand: imageOcr.text.includes("岗位需求"),
  },
}, null, 2));
