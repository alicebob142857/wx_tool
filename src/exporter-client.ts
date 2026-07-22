import type { Account, DailyReport, FeedbackPreferenceProfile, WechatArticle } from "./types.js";
import type { FeedbackTrainingRecord } from "./feedback-preference.js";
import type { AppConfig } from "./config.js";
import { validateAccounts } from "./config.js";

export class AuthExpiredError extends Error {
  constructor(message = "微信公众号授权已过期") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

interface AuthState {
  valid: boolean;
  expiresAt: string | null;
  qrAvailable?: boolean;
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`上游返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `上游请求失败（HTTP ${response.status}）`);
  }
  return data;
}

export class ExporterClient {
  constructor(private readonly config: AppConfig) {}

  private get usesAuthService(): boolean {
    return Boolean(this.config.authServiceUrl);
  }

  async checkAuth(): Promise<AuthState> {
    if (this.usesAuthService) {
      const response = await fetch(`${this.config.authServiceUrl}/api/status`, {
        headers: this.config.authServiceToken
          ? { Authorization: `Bearer ${this.config.authServiceToken}` }
          : undefined,
      });
      const data = await parseJsonResponse(response);
      return {
        valid: Boolean(data?.auth?.valid),
        expiresAt: data?.auth?.expiresAt || null,
        qrAvailable: Boolean(data?.login?.qrAvailable),
      };
    }

    if (!this.config.exporterAuthKey) {
      return { valid: false, expiresAt: null };
    }
    const response = await fetch(`${this.config.exporterBaseUrl}/api/public/v1/authkey`, {
      headers: { "X-Auth-Key": this.config.exporterAuthKey },
    });
    const data = await parseJsonResponse(response);
    return { valid: data?.code === 0, expiresAt: null };
  }

  async startLogin(): Promise<void> {
    if (!this.usesAuthService || !this.config.authServiceToken) return;
    const response = await fetch(`${this.config.authServiceUrl}/api/auth/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.authServiceToken}` },
    });
    await parseJsonResponse(response);
  }

  async getAccounts(): Promise<Account[] | null> {
    if (!this.usesAuthService) return null;
    const response = await fetch(`${this.config.authServiceUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${this.config.authServiceToken}` },
    });
    if (response.status === 404) return null;
    const data = await parseJsonResponse(response);
    return validateAccounts(data?.accounts || [], "D1 公众号列表", true);
  }

  async listArticles(account: Account): Promise<WechatArticle[]> {
    if (this.usesAuthService) {
      const url = new URL(`${this.config.authServiceUrl}/api/exporter/articles`);
      url.searchParams.set("fakeid", account.fakeid);
      url.searchParams.set("begin", "0");
      url.searchParams.set("size", "20");
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.authServiceToken}` },
      });
      if (response.status === 401) throw new AuthExpiredError();
      const data = await parseJsonResponse(response);
      if (data?.base_resp?.ret !== 0) {
        if (/认证|登录|auth/i.test(data?.base_resp?.err_msg || "")) throw new AuthExpiredError();
        throw new Error(data?.base_resp?.err_msg || `${account.name} 文章接口失败`);
      }
      return Array.isArray(data.articles) ? data.articles : [];
    }

    if (!this.config.exporterAuthKey) throw new AuthExpiredError("未配置 WX_EXPORTER_AUTH_KEY");
    const url = new URL(`${this.config.exporterBaseUrl}/api/public/v1/article`);
    url.searchParams.set("fakeid", account.fakeid);
    url.searchParams.set("begin", "0");
    url.searchParams.set("size", "20");
    const response = await fetch(url, {
      headers: { "X-Auth-Key": this.config.exporterAuthKey },
    });
    const data = await parseJsonResponse(response);
    if (data?.base_resp?.ret !== 0) {
      if (/认证|登录|auth/i.test(data?.base_resp?.err_msg || "")) throw new AuthExpiredError();
      throw new Error(data?.base_resp?.err_msg || `${account.name} 文章接口失败`);
    }
    return Array.isArray(data.articles) ? data.articles : [];
  }

  async downloadArticleHtml(articleUrl: string): Promise<string> {
    if (this.usesAuthService) {
      const url = new URL(`${this.config.authServiceUrl}/api/exporter/content`);
      url.searchParams.set("url", articleUrl);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.authServiceToken}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status === 401) throw new AuthExpiredError();
      if (!response.ok) throw new Error(`文章代理下载失败（HTTP ${response.status}）`);
      return response.text();
    }

    const url = new URL(`${this.config.exporterBaseUrl}/api/public/v1/download`);
    url.searchParams.set("url", articleUrl);
    url.searchParams.set("format", "html");
    const response = await fetch(url, {
      headers: this.config.exporterAuthKey ? { "X-Auth-Key": this.config.exporterAuthKey } : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Exporter 正文下载失败（HTTP ${response.status}）`);
    return response.text();
  }

  async saveReport(report: DailyReport): Promise<void> {
    if (!this.usesAuthService || !this.config.authServiceToken) return;
    const response = await fetch(`${this.config.authServiceUrl}/api/reports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.authServiceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(90_000),
    });
    await parseJsonResponse(response);
  }

  async getPreferences(): Promise<{
    customRequirement: string;
    considerFeedback: boolean;
    feedbackPreference?: FeedbackPreferenceProfile;
    feedbackRevision: number;
    feedbackProfileRevision: number;
    updatedAt: string | null;
  } | null> {
    if (!this.usesAuthService || !this.config.authServiceToken) return null;
    const response = await fetch(`${this.config.authServiceUrl}/api/preferences`, {
      headers: { Authorization: `Bearer ${this.config.authServiceToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await parseJsonResponse(response);
    return {
      customRequirement: String(data?.customRequirement || "").trim().slice(0, 2_000),
      considerFeedback: Boolean(data?.considerFeedback),
      feedbackPreference: data?.feedbackPreference && typeof data.feedbackPreference === "object"
        ? data.feedbackPreference as FeedbackPreferenceProfile
        : undefined,
      feedbackRevision: Number(data?.feedbackRevision || 0),
      feedbackProfileRevision: Number(data?.feedbackProfileRevision ?? 0),
      updatedAt: data?.updatedAt || null,
    };
  }

  async getFeedbackTraining(): Promise<{
    feedback: FeedbackTrainingRecord[];
    revision: number;
  } | null> {
    if (!this.usesAuthService || !this.config.authServiceToken) return null;
    const response = await fetch(`${this.config.authServiceUrl}/api/feedback/training`, {
      headers: { Authorization: `Bearer ${this.config.authServiceToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const data = await parseJsonResponse(response);
    return {
      feedback: Array.isArray(data?.feedback) ? data.feedback : [],
      revision: Number(data?.revision || 0),
    };
  }

  async saveGeneratedPreference(
    preference: FeedbackPreferenceProfile,
    feedbackRevision: number,
  ): Promise<void> {
    if (!this.usesAuthService || !this.config.authServiceToken) return;
    const response = await fetch(`${this.config.authServiceUrl}/api/preferences/generated`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.config.authServiceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ preference, feedbackRevision }),
      signal: AbortSignal.timeout(20_000),
    });
    await parseJsonResponse(response);
  }
}
