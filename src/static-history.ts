import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Account, DailyReport, JobPosition, UserProfile } from "./types.js";
import { personalizePosition } from "./recommendation.js";

interface StaticHistoryJob extends JobPosition {
  account: string;
  reportDate: string;
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

interface QualityPool {
  generatedAt: string | null;
  maxSize: 30;
  total: number;
  jobs: StaticHistoryJob[];
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
    "个性化优质岗位", "个性化分数", "个性化推荐理由", "个性化排除原因", "自定义要求匹配",
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
      job.personalized?.eligible ? "是" : "否", job.personalized?.score ?? "",
      job.personalized?.reasons || [], job.personalized?.concerns || [],
      !job.customRequirement?.active ? "未启用" : job.customRequirement.matched === true ? "符合" : job.customRequirement.matched === false ? "不符合" : "证据不足",
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
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
    const snapshot = JSON.parse(await readFile(path.join(rootDir, "site", "data", "accounts.json"), "utf8")) as PublicAccountConfig;
    if (Array.isArray(snapshot?.accounts)) return { count: snapshot.accounts.length, accounts: snapshot.accounts };
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    const accounts = JSON.parse(await readFile(path.join(rootDir, "config", "accounts.json"), "utf8")) as Account[];
    return { count: Array.isArray(accounts) ? accounts.length : 0, accounts: Array.isArray(accounts) ? accounts : [] };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { count: 0, accounts: [] };
    throw error;
  }
}

async function readPublicProfile(rootDir: string): Promise<UserProfile> {
  const fallback: UserProfile = {
    school: "北京师范大学",
    education: "硕士研究生",
    major: "行政管理",
    freshGraduate: true,
    customRequirement: "",
  };
  try {
    const profile = JSON.parse(await readFile(path.join(rootDir, "config", "profile.json"), "utf8")) as Partial<UserProfile>;
    return {
      school: String(profile.school || fallback.school),
      education: String(profile.education || fallback.education),
      major: String(profile.major || fallback.major),
      freshGraduate: profile.freshGraduate !== false,
      customRequirement: "",
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function deadlineTimestamp(deadline: string | null, now: Date): number | null {
  if (!deadline) return null;
  const normalized = deadline.replace(/[./]/g, "-");
  const full = normalized.match(/(20\d{2})\s*(?:年|-)?\s*(\d{1,2})\s*(?:月|-)?\s*(\d{1,2})\s*日?/);
  if (full) return Date.parse(`${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}T23:59:59+08:00`);
  const short = deadline.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!short) return null;
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now));
  return Date.parse(`${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}T23:59:59+08:00`);
}

function buildQualityPool(jobs: StaticHistoryJob[], generatedAt: string | null): QualityPool {
  const now = generatedAt ? new Date(generatedAt) : new Date();
  const uniqueJobs = new Map<string, StaticHistoryJob>();
  for (const job of jobs) {
    if (!job.personalized?.eligible) continue;
    const expiry = deadlineTimestamp(job.deadline, now);
    if (expiry !== null && expiry < now.getTime()) continue;
    const existing = uniqueJobs.get(job.id);
    if (!existing || Date.parse(job.article.publishedAt) > Date.parse(existing.article.publishedAt)) {
      uniqueJobs.set(job.id, job);
    }
  }
  const ranked = [...uniqueJobs.values()].sort((a, b) =>
    (b.personalized?.rankingKey || 0) - (a.personalized?.rankingKey || 0)
      || Date.parse(b.article.publishedAt) - Date.parse(a.article.publishedAt),
  ).slice(0, 30);
  return { generatedAt, maxSize: 30, total: ranked.length, jobs: ranked };
}

export async function buildStaticHistory(rootDir: string): Promise<StaticHistory> {
  const dataDir = path.join(rootDir, "site", "data");
  const reports = await readReports(path.join(dataDir, "daily"));
  const publicAccounts = await readPublicAccounts(rootDir);
  const publicProfile = await readPublicProfile(rootDir);
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
        jobs.push(personalizePosition({
          ...position,
          account: item.account,
          reportDate: report.date,
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
        }));
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
  const qualityPool = buildQualityPool(jobs, generatedAt);
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dataDir, "job-history.json"), `${JSON.stringify(history, null, 2)}\n`, "utf8"),
    writeFile(path.join(dataDir, "jobs.csv"), historyCsv(jobs), "utf8"),
    writeFile(path.join(dataDir, "accounts.json"), `${JSON.stringify(publicAccounts, null, 2)}\n`, "utf8"),
    writeFile(path.join(dataDir, "profile.json"), `${JSON.stringify(publicProfile, null, 2)}\n`, "utf8"),
    writeFile(path.join(dataDir, "quality-pool.json"), `${JSON.stringify(qualityPool, null, 2)}\n`, "utf8"),
  ]);
  return history;
}
