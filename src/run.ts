import { fetchAndParseArticle, looksLikeJobPost } from "./article-parser.js";
import { loadAccounts, loadConfig } from "./config.js";
import { classifyArticle, heuristicClassify } from "./deepseek.js";
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
        if (hasSeen(seen, article.link)) continue;
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

  for (const { account, article } of selected) {
    try {
      const parsed = await fetchAndParseArticle(article, url => client.downloadArticleHtml(url));
      const shouldOcr = parsed.imageUrls.length > 0 && (parsed.text.length < 1_500 || looksLikeJobPost(parsed.title));
      const ocr = shouldOcr
        ? await ocrImages(parsed.imageUrls, config.ocrMaxImages, config.ocrTimeoutMs)
        : { text: "", processed: 0, errors: [] as string[] };
      let classification;
      try {
        classification = await classifyArticle(config, parsed.title || article.title, parsed.text, ocr.text);
      } catch (error) {
        errors.push(`${account} / ${article.title}：DeepSeek 失败，已使用规则降级；${error instanceof Error ? error.message : String(error)}`);
        classification = heuristicClassify(parsed.title || article.title, `${parsed.text}\n${ocr.text}`);
      }
      if (classification.isRelevant) {
        items.push({
          id: stableId(article.link),
          account,
          title: parsed.title || article.title,
          url: article.link,
          publishedAt: isoFromUnix(article.update_time),
          ocrUsed: ocr.processed > 0,
          ocrImageCount: ocr.processed,
          ...classification,
        });
      }
      markSeen(seen, article.link);
    } catch (error) {
      stats.failedArticles += 1;
      failedUrls.add(article.link);
      errors.push(`${account} / ${article.title}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const { article } of queue.slice(config.maxArticlesPerRun)) markSeen(seen, article.link);
  for (const url of failedUrls) delete seen.urls[url];
  stats.relevantArticles = items.length;
  await saveSeen(config.rootDir, seen);

  const report: DailyReport = {
    date: dateInShanghai(),
    generatedAt: new Date().toISOString(),
    stats,
    items,
    errors,
  };
  await writeDailyReport(config.rootDir, report);
  const state = errors.length ? "partial" : "ok";
  await writeStatus(config.rootDir, {
    state,
    message: state === "ok" ? "今日采集完成。" : "今日采集完成，但部分文章处理失败。",
    lastRunAt: report.generatedAt,
    auth: { status: "valid", expiresAt: auth.expiresAt, qrAvailable: false },
    stats,
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
