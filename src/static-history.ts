import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Account, DailyReport, JobPosition } from "./types.js";

interface StaticHistoryJob extends JobPosition {
  account: string;
  article: {
    title: string;
    url: string;
    publishedAt: string;
    summary: string;
    ocrUsed: boolean;
    ocrImageCount: number;
    analysisSource: "deepseek" | "heuristic";
    extractionComplete: boolean;
  };
}

interface StaticHistory {
  date: "all";
  generatedAt: string | null;
  total: number;
  stats: {
    accountsConfigured: number;
    accountsSucceeded: number;
    articlesScanned: number;
    newArticles: number;
    candidateArticles: number;
    relevantArticles: number;
    positionsExtracted: number;
    failedArticles: number;
  };
  jobs: StaticHistoryJob[];
}

interface PublicAccountConfig {
  count: number;
  accounts: Account[];
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("；") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function previousGraduateLabel(value: unknown): string {
  return value === "yes" ? "是" : value === "no" ? "否" : "未明确";
}

function historyCsv(jobs: StaticHistoryJob[]): string {
  const headers = [
    "公众号", "更新日期", "企业性质", "公司/单位名称", "招聘类型", "行业", "推文标题",
    "招聘岗位", "岗位方向", "专业要求", "地点", "原文链接", "网申地址", "截止日期",
    "往届是否可投递", "学历要求", "适用届别", "内推码", "报考要求", "薪资", "福利待遇",
    "推荐分数", "推荐等级", "推荐理由", "不推荐理由", "招聘人数", "报名方式", "AI置信度",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const job of jobs) {
    lines.push([
      job.account, String(job.article.publishedAt || "").slice(0, 10), job.organizationNature,
      job.organization, job.employmentTypes, job.industry, job.article.title, job.jobTitle,
      job.jobDirections, job.majors.summary, job.locations, job.article.url, job.applicationUrl,
      job.deadline, previousGraduateLabel(job.previousGraduatesEligible), job.education.summary,
      job.graduateScope, job.referralCode, job.applicationRequirements, job.compensation.salary,
      job.compensation.benefits, job.recommendation.score, job.recommendation.level,
      job.recommendation.reasons, job.recommendation.concerns, job.headcount, job.applicationMethod,
      Math.round(Number(job.confidence || 0) * 100) / 100,
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

async function readReports(dailyDir: string): Promise<DailyReport[]> {
  let files: string[] = [];
  try {
    files = await readdir(dailyDir);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const reports: DailyReport[] = [];
  for (const file of files.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
    try {
      reports.push(JSON.parse(await readFile(path.join(dailyDir, file), "utf8")) as DailyReport);
    } catch (error) {
      console.warn(`跳过无法解析的历史报告 ${file}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return reports;
}

async function readPublicAccounts(rootDir: string): Promise<PublicAccountConfig> {
  try {
    const accounts = JSON.parse(await readFile(path.join(rootDir, "config", "accounts.json"), "utf8")) as Account[];
    return { count: Array.isArray(accounts) ? accounts.length : 0, accounts: Array.isArray(accounts) ? accounts : [] };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { count: 0, accounts: [] };
    throw error;
  }
}

export async function buildStaticHistory(rootDir: string): Promise<StaticHistory> {
  const dataDir = path.join(rootDir, "site", "data");
  const reports = await readReports(path.join(dataDir, "daily"));
  const publicAccounts = await readPublicAccounts(rootDir);
  const jobs: StaticHistoryJob[] = [];
  const accounts = new Set<string>();
  const articles = new Set<string>();
  let failedArticles = 0;
  let generatedAt: string | null = null;

  for (const report of reports) {
    if (!generatedAt || Date.parse(report.generatedAt) > Date.parse(generatedAt)) generatedAt = report.generatedAt;
    failedArticles += Number(report.stats?.failedArticles || 0);
    for (const item of report.items || []) {
      accounts.add(item.account);
      articles.add(item.id);
      for (const position of item.positions || []) {
        jobs.push({
          ...position,
          account: item.account,
          article: {
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            summary: item.summary,
            ocrUsed: item.ocrUsed,
            ocrImageCount: item.ocrImageCount,
            analysisSource: item.analysisSource,
            extractionComplete: item.extractionComplete,
          },
        });
      }
    }
  }
  jobs.sort((a, b) => {
    const byDate = Date.parse(b.article.publishedAt) - Date.parse(a.article.publishedAt);
    return byDate || (b.recommendation?.rankingKey || 0) - (a.recommendation?.rankingKey || 0);
  });
  const history: StaticHistory = {
    date: "all",
    generatedAt,
    total: jobs.length,
    stats: {
      accountsConfigured: accounts.size,
      accountsSucceeded: accounts.size,
      articlesScanned: articles.size,
      newArticles: articles.size,
      candidateArticles: articles.size,
      relevantArticles: articles.size,
      positionsExtracted: jobs.length,
      failedArticles,
    },
    jobs,
  };
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dataDir, "job-history.json"), `${JSON.stringify(history, null, 2)}\n`, "utf8"),
    writeFile(path.join(dataDir, "jobs.csv"), historyCsv(jobs), "utf8"),
    writeFile(path.join(dataDir, "accounts.json"), `${JSON.stringify(publicAccounts, null, 2)}\n`, "utf8"),
  ]);
  return history;
}
