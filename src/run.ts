import { fetchAndParseArticle, looksLikeJobPost } from "./article-parser.js";
import { loadAccounts, loadConfig } from "./config.js";
import { analyzeArticle, heuristicAnalyzeArticle } from "./deepseek.js";
import { AuthExpiredError, ExporterClient } from "./exporter-client.js";
import { ocrImages } from "./ocr.js";
import {
  hasSeen,
  loadSeen,
  markSeen,
  saveSeen,
  writeDailyReport,
  writeRuntimeConfig,
  writeStatus,
} from "./storage.js";
import type { DailyReport, ReportItem, RunStats, SiteStatus, WechatArticle } from "./types.js";
import { dateInShanghai, isoFromUnix, isWithinHours, stableId } from "./utils.js";

const emptyStats = (accounts: number): RunStats => ({
  accountsConfigured: accounts,
  accountsSucceeded: 0,
  articlesScanned: 0,
  newArticles: 0,
  candidateArticles: 0,
  relevantArticles: 0,
  positionsExtracted: 0,
  failedArticles: 0,
});

async function main(): Promise<void> {
  const config = loadConfig();
  const accounts = await loadAccounts(config.rootDir);
  const client = new ExporterClient(config);
  const stats = emptyStats(accounts.length);
  const nowIso = new Date().toISOString();
  await writeRuntimeConfig(config.rootDir, config.authServiceUrl);

  const auth = await client.checkAuth();
  if (!auth.valid) {
    await client.startLogin().catch(() => undefined);
    const status: SiteStatus = {
      state: "auth_required",
      message: "微信公众号授权已过期，请在网页扫码恢复。",
      lastRunAt: nowIso,
      auth: { status: "expired", expiresAt: auth.expiresAt, qrAvailable: true },
      stats,
    };
    await writeStatus(config.rootDir, status);
    console.log("AUTH_REQUIRED");
    return;
  }

  const seen = await loadSeen(config.rootDir);
  const queue: Array<{ account: string; article: WechatArticle }> = [];
  const errors: string[] = [];
  const failedUrls = new Set<string>();

  for (const account of accounts) {
    try {
      const articles = await client.listArticles(account);
      stats.accountsSucceeded += 1;
      stats.articlesScanned += articles.length;
      for (const article of articles) {
        if (!article.link || article.is_deleted) continue;
        const forceReprocess = config.forceReprocessHours > 0 && isWithinHours(article.update_time, config.forceReprocessHours);
        if (!forceReprocess && hasSeen(seen, article.link)) continue;
        if (!isWithinHours(article.update_time, config.lookbackHours)) {
          markSeen(seen, article.link);
          continue;
        }
        stats.newArticles += 1;
        const preview = `${article.title}\n${article.digest || ""}\n${article.content || ""}`;
        if (!looksLikeJobPost(preview)) {
          markSeen(seen, article.link);
          continue;
        }
        queue.push({ account: account.name, article });
      }
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        await client.startLogin().catch(() => undefined);
        await writeStatus(config.rootDir, {
          state: "auth_required",
          message: "微信公众号授权在采集过程中失效，请扫码恢复。",
          lastRunAt: nowIso,
          auth: { status: "expired", expiresAt: auth.expiresAt, qrAvailable: true },
          stats,
        });
        await saveSeen(config.rootDir, seen);
        console.log("AUTH_REQUIRED");
        return;
      }
      errors.push(`${account.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  queue.sort((a, b) => b.article.update_time - a.article.update_time);
  const selected = queue.slice(0, config.maxArticlesPerRun);
  stats.candidateArticles = selected.length;
  const items: ReportItem[] = [];
  console.log(`CANDIDATES ${selected.length} / NEW ${stats.newArticles}`);

  let articleCursor = 0;
  const processArticle = async () => {
    while (articleCursor < selected.length) {
      const articleIndex = articleCursor++;
      const { account, article } = selected[articleIndex];
      try {
        const parsed = await fetchAndParseArticle(article, url => client.downloadArticleHtml(url));
        const imageRequirementHint = /(?:岗位|职位)(?:表|信息|需求)|招聘计划.{0,12}(?:如下|详见)/.test(parsed.text.slice(0, 8_000));
        const shouldOcr =
          parsed.imageUrls.length > 0 &&
          (parsed.text.length < 600 || (parsed.text.length < 8_000 && imageRequirementHint));
        console.log(`ARTICLE ${articleIndex + 1}/${selected.length} ${account} | text=${parsed.text.length} images=${parsed.imageUrls.length} ocr=${shouldOcr}`);
        const ocr = shouldOcr
          ? await ocrImages(
              parsed.imageUrls,
              config.ocrMaxImages,
              config.ocrTimeoutMs,
              config.ocrArticleBudgetMs,
            )
          : { text: "", processed: 0, errors: [] as string[] };
        let analysis;
        try {
          analysis = await analyzeArticle(config, parsed.title || article.title, article.link, parsed.text, ocr.text);
        } catch (error) {
          errors.push(`${account} / ${article.title}：DeepSeek 失败，已使用规则降级；${error instanceof Error ? error.message : String(error)}`);
          analysis = heuristicAnalyzeArticle(parsed.title || article.title, `${parsed.text}\n${ocr.text}`, article.link);
        }
        if (analysis.isRecruitment && analysis.positions.length > 0) {
          items.push({
            id: stableId(article.link),
            account,
            title: parsed.title || article.title,
            url: article.link,
            publishedAt: isoFromUnix(article.update_time),
            ocrUsed: ocr.processed > 0,
            ocrImageCount: ocr.processed,
            summary: analysis.summary,
            positions: analysis.positions,
            analysisSource: analysis.source,
            extractionComplete: analysis.extractionComplete,
            notes: [...analysis.notes, ...ocr.errors],
          });
        }
        markSeen(seen, article.link);
      } catch (error) {
        stats.failedArticles += 1;
        failedUrls.add(article.link);
        errors.push(`${account} / ${article.title}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, config.articleConcurrency), selected.length) },
      processArticle,
    ),
  );
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  for (const { article } of queue.slice(config.maxArticlesPerRun)) markSeen(seen, article.link);
  for (const url of failedUrls) delete seen.urls[url];
  stats.relevantArticles = items.length;
  stats.positionsExtracted = items.reduce((sum, item) => sum + item.positions.length, 0);
  await saveSeen(config.rootDir, seen);
  const replaceItemIds = selected
    .filter(({ article }) => !failedUrls.has(article.link))
    .map(({ article }) => stableId(article.link));

  const report: DailyReport = {
    date: dateInShanghai(),
    generatedAt: new Date().toISOString(),
    stats,
    items,
    errors,
  };
  let mergedReport = await writeDailyReport(config.rootDir, report, replaceItemIds);
  try {
    await client.saveReport(mergedReport);
  } catch (error) {
    errors.push(`数据库写入失败：${error instanceof Error ? error.message : String(error)}`);
    mergedReport = await writeDailyReport(config.rootDir, { ...report, errors }, replaceItemIds);
  }
  const state = errors.length ? "partial" : "ok";
  await writeStatus(config.rootDir, {
    state,
    message: state === "ok" ? "今日采集完成。" : "今日采集完成，但部分文章处理失败。",
    lastRunAt: mergedReport.generatedAt,
    auth: { status: "valid", expiresAt: auth.expiresAt, qrAvailable: false },
    stats: mergedReport.stats,
  });
  console.log(JSON.stringify({ state, date: report.date, stats }, null, 2));
}

main().catch(async error => {
  const config = loadConfig();
  const message = error instanceof Error ? error.message : String(error);
  await writeStatus(config.rootDir, {
    state: "error",
    message,
    lastRunAt: new Date().toISOString(),
    auth: { status: "unknown", expiresAt: null, qrAvailable: false },
    stats: null,
  }).catch(() => undefined);
  console.error(message);
  process.exitCode = 1;
});
