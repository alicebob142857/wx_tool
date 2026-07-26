import { loadConfig, loadWritingAccounts } from "./config.js";
import { AuthExpiredError, ExporterClient } from "./exporter-client.js";
import { ocrImages } from "./ocr.js";
import { dateInShanghai, isoFromUnix, isWithinHours } from "./utils.js";
import {
  extractWritingExample,
  looksLikeWritingCandidate,
  parseWritingArticleHtml,
  writingEntryFromExtraction,
} from "./writing-extractor.js";
import {
  hasSeenWriting,
  loadWritingSeen,
  markWritingSeen,
  saveWritingSeen,
  writeWritingAccounts,
  writeWritingStatus,
} from "./writing-storage.js";
import type { WechatArticle } from "./types.js";
import type { WritingAccount, WritingEntry, WritingRunStats } from "./writing-types.js";

function canonicalArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "mp.weixin.qq.com" && /^\/s\/[^/]+/.test(url.pathname)) {
      return `${url.origin}${url.pathname}`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (!["__biz", "mid", "idx", "sn"].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function emptyStats(accounts: number): WritingRunStats {
  return {
    accountsConfigured: accounts,
    accountsSucceeded: 0,
    articlesScanned: 0,
    newArticles: 0,
    candidateArticles: 0,
    examplesStored: 0,
    failedArticles: 0,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new ExporterClient(config);
  const fallbackAccounts = await loadWritingAccounts(config.rootDir);
  let accounts: WritingAccount[] = fallbackAccounts;
  try {
    const managed = await client.getWritingAccounts();
    if (managed !== null) accounts = managed;
  } catch (error) {
    console.warn(`范文公众号列表读取失败，使用本地兜底：${error instanceof Error ? error.message : String(error)}`);
  }
  await writeWritingAccounts(config.rootDir, accounts);
  const stats = emptyStats(accounts.length);
  const auth = await client.checkAuth();
  if (!auth.valid) {
    await client.startLogin().catch(() => undefined);
    await writeWritingStatus(config.rootDir, {
      state: "auth_required",
      message: "微信公众号授权已过期，请在网页扫码后继续更新范文库。",
      lastRunAt: new Date().toISOString(),
      stats,
    });
    console.log("WRITING_AUTH_REQUIRED");
    return;
  }

  const seen = await loadWritingSeen(config.rootDir);
  const queue: Array<{ account: WritingAccount; article: WechatArticle }> = [];
  const queuedUrls = new Set<string>();
  const errors: string[] = [];

  const enqueue = (account: WritingAccount, article: WechatArticle, force = false) => {
    const link = canonicalArticleUrl(article.link || "");
    if (!link || queuedUrls.has(link) || hasSeenWriting(seen, link)) return;
    article = { ...article, link };
    if (!force && !isWithinHours(article.update_time, config.writingLookbackHours)) {
      markWritingSeen(seen, link);
      return;
    }
    stats.newArticles += 1;
    if (!looksLikeWritingCandidate(article.title || "", article.digest || "") && !force) {
      markWritingSeen(seen, link);
      return;
    }
    queuedUrls.add(link);
    queue.push({ account, article });
  };

  for (const account of accounts) {
    try {
      const articles = await client.listArticles(account);
      stats.accountsSucceeded += 1;
      stats.articlesScanned += articles.length;
      const seedUrl = account.seedArticleUrl ? canonicalArticleUrl(account.seedArticleUrl) : "";
      const seedArticle = seedUrl
        ? articles.find(article => canonicalArticleUrl(article.link) === seedUrl)
        : undefined;
      if (seedArticle) enqueue(account, seedArticle, true);
      else if (seedUrl && !hasSeenWriting(seen, seedUrl)) {
        enqueue(account, {
          title: account.name,
          link: seedUrl,
          update_time: Math.floor(
            (account.seedPublishedAt ? Date.parse(account.seedPublishedAt) : Date.now()) / 1000,
          ),
        }, true);
      }
      for (const article of articles) {
        if (!article.link || article.is_deleted) continue;
        enqueue(account, article);
      }
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        await client.startLogin().catch(() => undefined);
        await saveWritingSeen(config.rootDir, seen);
        await writeWritingStatus(config.rootDir, {
          state: "auth_required",
          message: "微信公众号授权在范文采集过程中失效，请扫码恢复。",
          lastRunAt: new Date().toISOString(),
          stats,
        });
        console.log("WRITING_AUTH_REQUIRED");
        return;
      }
      errors.push(`${account.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  queue.sort((a, b) => b.article.update_time - a.article.update_time);
  const targetExamples = config.writingMaxArticlesPerRun;
  const entries: WritingEntry[] = [];
  let cursor = 0;
  const failedUrls = new Set<string>();

  const processNext = async () => {
    while (cursor < queue.length && entries.length < targetExamples) {
      const index = cursor++;
      const { account, article } = queue[index];
      stats.candidateArticles += 1;
      try {
        const html = await client.downloadArticleHtml(article.link);
        const parsed = parseWritingArticleHtml(html, article.title);
        const shouldOcr = parsed.imageUrls.length > 0 && parsed.text.length < 1_000;
        const ocr = shouldOcr
          ? await ocrImages(
            parsed.imageUrls,
            config.ocrMaxImages,
            config.ocrTimeoutMs,
            config.ocrArticleBudgetMs,
          )
          : { text: "", processed: 0, errors: [] as string[] };
        let extraction;
        try {
          extraction = await extractWritingExample(config, parsed.title || article.title, parsed.text, ocr.text);
        } catch (error) {
          errors.push(`${account.name} / ${article.title}：DeepSeek 失败，使用规则拆分；${error instanceof Error ? error.message : String(error)}`);
          extraction = await extractWritingExample(
            { ...config, classifierMode: "heuristic" },
            parsed.title || article.title,
            parsed.text,
            ocr.text,
          );
        }
        let stored = false;
        if (extraction.isExample && entries.length < targetExamples) {
          entries.push(writingEntryFromExtraction({
            account: parsed.accountName || account.name,
            accountFakeid: account.fakeid,
            articleTitle: parsed.title || article.title,
            articleUrl: article.link,
            publishedAt: isoFromUnix(article.update_time),
            extraction,
          }));
          stored = true;
        }
        // 并发任务可能在目标数量刚达成时同时完成。未入库的有效范文留给下次，
        // 避免文章被标记为已处理后永久丢失。
        if (!extraction.isExample || stored) markWritingSeen(seen, article.link);
        console.log(`WRITING ${index + 1}/${queue.length} ${account.name} | stored=${stored}`);
      } catch (error) {
        stats.failedArticles += 1;
        failedUrls.add(article.link);
        errors.push(`${account.name} / ${article.title}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, config.writingArticleConcurrency), queue.length) },
    processNext,
  ));
  for (const url of failedUrls) delete seen.urls[url];
  stats.examplesStored = entries.length;
  await saveWritingSeen(config.rootDir, seen);

  const report = {
    date: dateInShanghai(),
    generatedAt: new Date().toISOString(),
    stats,
    entries: entries.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    errors,
  };
  try {
    await client.saveWritingReport(report);
  } catch (error) {
    errors.push(`范文数据库写入失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const state = errors.length ? "partial" : "ok";
  await writeWritingStatus(config.rootDir, {
    state,
    message: state === "ok" ? "今日范文与点评采集完成。" : "范文采集完成，但部分内容处理失败。",
    lastRunAt: report.generatedAt,
    stats,
  });
  console.log(JSON.stringify({ state, date: report.date, stats }, null, 2));
}

main().catch(async error => {
  const config = loadConfig();
  const message = error instanceof Error ? error.message : String(error);
  await writeWritingStatus(config.rootDir, {
    state: "error",
    message,
    lastRunAt: new Date().toISOString(),
    stats: null,
  }).catch(() => undefined);
  console.error(message);
  process.exitCode = 1;
});
