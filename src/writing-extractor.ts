import * as cheerio from "cheerio";
import type { AppConfig } from "./config.js";
import { extractJsonObject } from "./deepseek.js";
import type { WritingCommentarySection, WritingEntry } from "./writing-types.js";
import { classifyWritingTopic, normalizeWritingTopic } from "./writing-topics.js";
import { normalizeWhitespace, stableId } from "./utils.js";

interface ParsedWritingArticle {
  title: string;
  accountName: string;
  text: string;
  imageUrls: string[];
}

interface WritingExtraction {
  isExample: boolean;
  essayTitle: string;
  theme: string;
  majorTopic: import("./writing-topics.js").WritingMajorTopic;
  subtopic: string;
  keywords: string[];
  summary: string;
  essayText: string;
  commentarySections: WritingCommentarySection[];
  sourceNote: string | null;
  source: "deepseek" | "heuristic";
  confidence: number;
}

const WRITING_HINT = /申论|范文|大作文|文章精读|时评|评论文章|公文写作/;
const PROMOTION_MARKERS = [
  "如果觉得还有点帮助",
  "一门课解决申论",
  "扫描添加老师微信",
  "扫描下载文章PDF",
  "更多学习资料",
  "点赞”“转发",
];

function cleanImageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.replace(/&amp;/g, "&").trim();
  if (!/^https?:\/\//i.test(value) || /\/0\?wx_fmt=(gif|svg)/i.test(value)) return null;
  return value;
}

function normalizeWritingText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseWritingArticleHtml(html: string, fallbackTitle = ""): ParsedWritingArticle {
  const $ = cheerio.load(html);
  const article = $("#js_article");
  const content = $("#js_content");
  const title = normalizeWhitespace(
    $("meta[property='og:title']").attr("content")
      || $("#activity-name").text()
      || $("h1").first().text()
      || fallbackTitle,
  );
  const accountName = normalizeWhitespace($("#js_name").text() || $(".rich_media_meta_nickname").first().text());

  article.find("script, style, #js_top_ad_area, #content_bottom_area, #js_pc_qr_code").remove();
  const textRoot = content.length ? content : article;
  textRoot.find("br").replaceWith("\n");
  textRoot.find("p, h1, h2, h3, h4, h5, h6, li, blockquote").each((_index, element) => {
    $(element).append("\n");
  });
  const text = normalizeWritingText(textRoot.text());

  const urls = new Set<string>();
  textRoot.find("img").each((_index, element) => {
    const node = $(element);
    const url = cleanImageUrl(node.attr("data-src") || node.attr("data-original") || node.attr("src"));
    if (url) urls.add(url);
  });
  return { title, accountName, text, imageUrls: [...urls] };
}

export function looksLikeWritingCandidate(title: string, digest = ""): boolean {
  return WRITING_HINT.test(`${title}\n${digest}`);
}

function derivedEssayTitle(articleTitle: string): string {
  return articleTitle
    .replace(/^[【\[]?(?:重点)?(?:申论)?范文[】\]]?\s*[：:｜|·-]?\s*/u, "")
    .replace(/^文章精读\s*[：:｜|·-]?\s*/u, "")
    .trim() || articleTitle.trim();
}

function commentaryLabel(commentary: string, index: number): string {
  const explicit = commentary.match(/第([一二三四五六七八九十\d]+)段|开头|结尾|分论点[一二三四五六七八九十\d]+/);
  return explicit?.[0] || `第 ${index + 1} 处点评`;
}

export function splitWritingText(articleTitle: string, rawText: string): {
  essayTitle: string;
  essayText: string;
  commentarySections: WritingCommentarySection[];
  keywords: string[];
  sourceNote: string | null;
} {
  const text = normalizeWritingText(rawText);
  const commentarySections: WritingCommentarySection[] = [];
  const commentaryPattern = /【\s*([^【】]{0,60}?(?:解析|点评|评析))\s*[：:]\s*([\s\S]*?)】/gu;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = commentaryPattern.exec(text))) {
    const commentary = normalizeWritingText(match[2] || "");
    if (!commentary) continue;
    commentarySections.push({ sectionTitle: commentaryLabel(commentary, index++), commentary });
  }

  let essayText = text.replace(commentaryPattern, "\n");
  const sourceNoteMatch = essayText.match(/【\s*注\s*】\s*([\s\S]*?)(?=$|\n{2,})/u);
  const sourceNote = sourceNoteMatch ? normalizeWritingText(sourceNoteMatch[1]) : null;
  essayText = essayText.replace(/【\s*注\s*】[\s\S]*$/u, "");

  const essayTitle = derivedEssayTitle(articleTitle);
  const titleIndex = essayTitle.length >= 4 ? essayText.indexOf(essayTitle) : -1;
  if (titleIndex >= 0) essayText = essayText.slice(titleIndex + essayTitle.length);
  for (const marker of PROMOTION_MARKERS) {
    const markerIndex = essayText.indexOf(marker);
    if (markerIndex >= 0) essayText = essayText.slice(0, markerIndex);
  }
  essayText = normalizeWritingText(essayText)
    .replace(/^关键词\s*[：:].*?(?:\n|$)/u, "")
    .trim();

  const keywordMatch = text.match(/关键词\s*[：:]\s*([^\n【]{2,100})/u);
  const keywords = keywordMatch
    ? keywordMatch[1].split(/[；;，,、\s]+/u).map(item => item.trim()).filter(Boolean).slice(0, 10)
    : [];
  return { essayTitle, essayText, commentarySections, keywords, sourceNote };
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean).slice(0, 12)
    : [];
}

function safeConfidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function heuristicExtraction(articleTitle: string, text: string): WritingExtraction {
  const split = splitWritingText(articleTitle, text);
  const commentaryText = split.commentarySections.map(item => item.commentary).join("\n");
  const isExample = split.essayText.length >= 200 && commentaryText.length >= 60;
  const topic = classifyWritingTopic({
    title: split.essayTitle,
    theme: split.keywords.join("、"),
    keywords: split.keywords,
    text: split.essayText,
  });
  return {
    isExample,
    essayTitle: split.essayTitle,
    theme: split.keywords.join("、") || split.essayTitle,
    ...topic,
    keywords: split.keywords,
    summary: isExample ? `${split.essayTitle}的申论范文及逐段点评。` : "未检测到可完整拆分的范文和点评。",
    essayText: split.essayText,
    commentarySections: split.commentarySections,
    sourceNote: split.sourceNote,
    source: "heuristic",
    confidence: isExample ? 0.78 : 0.35,
  };
}

function parseModelExtraction(raw: string, articleTitle: string, text: string): WritingExtraction {
  const result = extractJsonObject(raw);
  const deterministic = splitWritingText(articleTitle, text);
  const modelSections: WritingCommentarySection[] = Array.isArray(result?.commentary_sections)
    ? result.commentary_sections.map((item: any, index: number) => ({
      sectionTitle: String(item?.section_title || `第 ${index + 1} 处点评`).trim(),
      commentary: String(item?.commentary || "").trim(),
    })).filter((item: WritingCommentarySection) => item.commentary)
    : [];
  const modelEssay = String(result?.essay_text || "").trim();
  const useDeterministicEssay = deterministic.essayText.length >= 200;
  const useDeterministicCommentary =
    deterministic.commentarySections.map(item => item.commentary).join("").length >= 60;
  const essayText = useDeterministicEssay ? deterministic.essayText : modelEssay;
  const commentarySections = useDeterministicCommentary ? deterministic.commentarySections : modelSections;
  const commentaryText = commentarySections.map(item => item.commentary).join("\n");
  const isExample = Boolean(result?.is_example) && essayText.length >= 200 && commentaryText.length >= 60;
  const theme = String(result?.theme || deterministic.keywords.join("、") || deterministic.essayTitle).trim();
  const keywords = safeStringArray(result?.keywords).length
    ? safeStringArray(result.keywords)
    : deterministic.keywords;
  const topic = normalizeWritingTopic(result?.major_topic, result?.subtopic, {
    title: String(result?.essay_title || deterministic.essayTitle || articleTitle),
    theme,
    keywords,
    summary: String(result?.summary || ""),
    text: essayText,
  });
  return {
    isExample,
    essayTitle: String(result?.essay_title || deterministic.essayTitle || articleTitle).trim(),
    theme,
    ...topic,
    keywords,
    summary: String(result?.summary || "").trim(),
    essayText,
    commentarySections,
    sourceNote: String(result?.source_note || deterministic.sourceNote || "").trim() || null,
    source: "deepseek",
    confidence: safeConfidence(result?.confidence),
  };
}

export async function extractWritingExample(
  config: AppConfig,
  articleTitle: string,
  articleText: string,
  ocrText = "",
): Promise<WritingExtraction> {
  const combined = normalizeWritingText(`${articleText}\n${ocrText}`);
  const fallback = heuristicExtraction(articleTitle, combined);
  if (config.classifierMode === "heuristic" || !config.deepseekApiKey) return fallback;

  const system = `你是严谨的申论范文资料整理员。判断公众号文章是否同时包含：
1. 一篇可以独立阅读的申论/时评/大作文范文正文；
2. 作者或老师对该范文的明确解析、点评或评析。

课程广告、答疑、资料推广、纯金句合集、只有范文没有点评、只有点评没有完整范文，都不要入库。
提取时必须遵守：
- 范文和点评严格分开，不能把“解析/点评”混入 essay_text。
- 保留原文，不改写、不缩写、不补写；删除开头引流、课程广告、二维码和点赞转发提示。
- commentary_sections 按原文顺序保存，每处点评只放老师的点评原文，并给出简短位置名称。
- theme 和 keywords 用于检索，可以归纳；summary 只写一句。
- major_topic 必须且只能从“政治、经济、社会、文化、生态、科技”中选择一个。
- subtopic 必须从对应大方向的固定选项中选择：
  政治：理论作风、改革创新、干部担当、党建引领、基层治理、法治建设；
  经济：产业发展、营商环境、就业人才、乡村振兴、区域协调、消费发展；
  社会：社区服务、城市治理、公共服务、民生保障、教育发展、青年成长；
  文化：文化传承、文明建设、文旅融合、文化自信、文艺传播；
  生态：绿色发展、环境治理、低碳转型、生态保护、美丽中国；
  科技：人工智能、数字治理、科技创新、数据发展、产业升级、网络安全。
- source_note 只保存文章来源注释，没有则为 null。

只返回 JSON，不要 Markdown：
{"is_example":true,"essay_title":"范文标题","theme":"主题","major_topic":"社会","subtopic":"社区服务","keywords":["关键词"],"summary":"一句话摘要","essay_text":"完整范文正文","commentary_sections":[{"section_title":"开头点评","commentary":"点评原文"}],"source_note":null,"confidence":0.9}`;
  const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: 0,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `文章标题：${articleTitle}\n\n文章正文及图片OCR：\n${combined.slice(0, 40_000)}` },
      ],
    }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek 范文提取失败（HTTP ${response.status}）：${body.slice(0, 180)}`);
  }
  const payload: any = await response.json();
  const raw = payload?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek 范文提取返回为空");
  return parseModelExtraction(raw, articleTitle, combined);
}

export function writingEntryFromExtraction(input: {
  account: string;
  accountFakeid: string;
  articleTitle: string;
  articleUrl: string;
  publishedAt: string;
  collectedAt?: string;
  extraction: WritingExtraction;
}): WritingEntry {
  const commentaryText = input.extraction.commentarySections.map(item => item.commentary).join("\n\n");
  return {
    id: stableId(input.articleUrl),
    account: input.account,
    accountFakeid: input.accountFakeid,
    articleTitle: input.articleTitle,
    articleUrl: input.articleUrl,
    publishedAt: input.publishedAt,
    collectedAt: input.collectedAt || new Date().toISOString(),
    essayTitle: input.extraction.essayTitle,
    theme: input.extraction.theme,
    majorTopic: input.extraction.majorTopic,
    subtopic: input.extraction.subtopic,
    keywords: input.extraction.keywords,
    summary: input.extraction.summary,
    essayText: input.extraction.essayText,
    commentarySections: input.extraction.commentarySections,
    commentaryText,
    sourceNote: input.extraction.sourceNote,
    wordCount: input.extraction.essayText.replace(/\s/g, "").length,
    analysisSource: input.extraction.source,
    confidence: input.extraction.confidence,
  };
}
