import * as cheerio from "cheerio";
import type { ParsedArticle, WechatArticle } from "./types.js";
import { normalizeWhitespace } from "./utils.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const JOB_HINTS = [
  "招聘",
  "校招",
  "社招",
  "秋招",
  "春招",
  "招录",
  "招考",
  "聘用",
  "岗位",
  "实习",
  "管培",
  "人才",
  "毕业生",
  "应届",
  "提前批",
  "开放日",
  "选调",
  "补录",
  "简历",
  "career",
  "intern",
];

export function looksLikeJobPost(text: string): boolean {
  const lower = text.toLowerCase();
  return JOB_HINTS.some(keyword => lower.includes(keyword.toLowerCase()));
}

function cleanImageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.replace(/&amp;/g, "&").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  if (/\/0\?wx_fmt=(gif|svg)/i.test(value)) return null;
  return value;
}

export function parseArticleHtml(html: string, fallbackTitle = ""): ParsedArticle {
  const $ = cheerio.load(html);
  const article = $("#js_article");
  const content = $("#js_content");
  const title = normalizeWhitespace(
    $("meta[property='og:title']").attr("content") ||
      $("#activity-name").text() ||
      $("h1").first().text() ||
      fallbackTitle,
  );

  article.find("script, style, #js_top_ad_area, #content_bottom_area, #js_pc_qr_code").remove();
  const textRoot = content.length ? content : article;
  const text = normalizeWhitespace(textRoot.text());

  const urls = new Set<string>();
  textRoot.find("img").each((_index, element) => {
    const node = $(element);
    const url = cleanImageUrl(node.attr("data-src") || node.attr("data-original") || node.attr("src"));
    if (url) urls.add(url);
  });

  return { title, text, imageUrls: [...urls] };
}

export async function fetchAndParseArticle(
  article: WechatArticle,
  fetchHtml?: (url: string) => Promise<string>,
): Promise<ParsedArticle> {
  let html: string;
  if (fetchHtml) {
    html = await fetchHtml(article.link);
  } else {
    const response = await fetch(article.link, {
      headers: {
        Referer: "https://mp.weixin.qq.com/",
        Origin: "https://mp.weixin.qq.com",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      throw new Error(`文章下载失败（HTTP ${response.status}）`);
    }
    html = await response.text();
  }
  const parsed = parseArticleHtml(html, article.title);
  if (!parsed.text && article.content) parsed.text = normalizeWhitespace(article.content);
  if (!parsed.text && parsed.imageUrls.length === 0) {
    throw new Error("文章正文为空，可能遇到微信验证页或文章已删除");
  }
  return parsed;
}
