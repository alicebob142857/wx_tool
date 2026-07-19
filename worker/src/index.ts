interface Env {
  AUTH_KV: KVNamespace;
  JOB_DB: D1Database;
  COLLECTOR_TOKEN: string;
  SITE_PASSWORD_HASH?: string;
  ALLOWED_ORIGIN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_DISPATCH_TOKEN?: string;
}

interface ReportPayload {
  date: string;
  generatedAt: string;
  stats: Record<string, number>;
  items: any[];
  errors: string[];
}

interface LoginSession {
  id: string;
  uuidCookie: string;
  createdAt: string;
  status: number;
}

interface StoredAuth {
  token: string;
  cookies: string[];
  nickname?: string;
  createdAt: string;
  expiresAt: string;
}

interface ManagedAccount {
  fakeid: string;
  name: string;
  alias: string;
  avatarUrl: string;
  status: "active" | "paused" | "removed";
  source: "bootstrap" | "name_search" | "article_url" | "manual";
  addedAt: string;
  updatedAt: string;
}

interface SearchCandidate {
  fakeid: string;
  name: string;
  alias: string;
  avatarUrl: string;
}

const LOGIN_KEY = "login:current";
const AUTH_KEY = "auth:current";
const SITE_SESSION_PREFIX = "site-session:";
const ACCOUNT_SEARCH_PREFIX = "account-search:";
const SITE_SESSION_TTL = 180 * 24 * 60 * 60;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULT_ACCOUNTS: SearchCandidate[] = [
  { name: "央企求职网", fakeid: "MzIzMzcyNjU1MQ==", alias: "yangqiqiuzhi", avatarUrl: "" },
  { name: "五财一贸", fakeid: "MzAwMDY2Mjc1Mw==", alias: "wucaiyimao", avatarUrl: "" },
  { name: "国企求职网", fakeid: "MzIxMTU3OTA5Nw==", alias: "guoqizhaopinwang", avatarUrl: "" },
  { name: "晓央就业", fakeid: "MzkyNTIwMDA1OQ==", alias: "cufe-coco", avatarUrl: "" },
  { name: "北大就业", fakeid: "MzA4NjAzMTIxNw==", alias: "pku_scc", avatarUrl: "" },
  { name: "国资小新", fakeid: "MjM5MDIxNjczNA==", alias: "guozixiaoxin", avatarUrl: "" },
  { name: "国聘", fakeid: "MzU4MzQ2NzUxMw==", alias: "iguopincom", avatarUrl: "" },
  { name: "人大就业创业", fakeid: "MjM5MTE5MTY4Mw==", alias: "RUCcareercenter", avatarUrl: "" },
  { name: "清华就业", fakeid: "MzUyMjc4NjA4Nw==", alias: "THUCareer", avatarUrl: "" },
  { name: "北航就业", fakeid: "MjM5MzI0Nzc2Ng==", alias: "", avatarUrl: "" },
];

let runtimeSchemaReady: Promise<void> | null = null;

async function ensureRuntimeSchema(env: Env): Promise<void> {
  if (!runtimeSchemaReady) {
    runtimeSchemaReady = (async () => {
      const now = new Date().toISOString();
      await env.JOB_DB.batch([
        env.JOB_DB.prepare(`CREATE TABLE IF NOT EXISTS position_personalization (
          position_id TEXT PRIMARY KEY,
          custom_requirement_json TEXT NOT NULL DEFAULT '{}',
          personalized_json TEXT NOT NULL DEFAULT '{}',
          personalized_eligible INTEGER NOT NULL DEFAULT 0,
          personalized_ranking_key INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
        )`),
        env.JOB_DB.prepare(`CREATE TABLE IF NOT EXISTS user_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          custom_requirement TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`),
        env.JOB_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_position_personalized_pool
          ON position_personalization(personalized_eligible, personalized_ranking_key DESC)`),
        env.JOB_DB.prepare(`CREATE TABLE IF NOT EXISTS monitored_accounts (
          fakeid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          alias TEXT NOT NULL DEFAULT '',
          avatar_url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'removed')),
          source TEXT NOT NULL DEFAULT 'name_search',
          added_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`),
        env.JOB_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_monitored_accounts_status_name
          ON monitored_accounts(status, name)`),
        ...DEFAULT_ACCOUNTS.map(account => env.JOB_DB.prepare(`INSERT OR IGNORE INTO monitored_accounts
          (fakeid, name, alias, avatar_url, status, source, added_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', 'bootstrap', ?, ?)`)
          .bind(account.fakeid, account.name, account.alias, account.avatarUrl, now, now)),
      ]);
    })().catch(error => {
      runtimeSchemaReady = null;
      throw error;
    });
  }
  await runtimeSchemaReady;
}

function corsHeaders(request: Request, env: Env): Headers {
  const requestOrigin = request.headers.get("Origin") || "";
  const configured = env.ALLOWED_ORIGIN || "*";
  const allowOrigin = configured === "*" || configured.split(",").map(item => item.trim()).includes(requestOrigin)
    ? configured === "*" ? "*" : requestOrigin
    : "null";
  return new Headers({
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
}

function json(request: Request, env: Env, value: unknown, status = 200): Response {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.COLLECTOR_TOKEN;
  if (!expected) return false;
  return request.headers.get("Authorization") === `Bearer ${expected}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function siteAuthorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return Boolean(await env.AUTH_KV.get(`${SITE_SESSION_PREFIX}${token}`));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function loginSite(request: Request, env: Env): Promise<Response> {
  if (!env.SITE_PASSWORD_HASH) return json(request, env, { message: "网站密码尚未配置" }, 503);
  const body = await request.json<{ password?: string }>().catch(() => ({ password: "" }));
  const providedHash = await sha256(String(body.password || ""));
  if (!constantTimeEqual(providedHash, env.SITE_PASSWORD_HASH)) {
    return json(request, env, { message: "密码不正确" }, 401);
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SITE_SESSION_TTL * 1_000).toISOString();
  await env.AUTH_KV.put(`${SITE_SESSION_PREFIX}${token}`, JSON.stringify({ createdAt: new Date().toISOString() }), {
    expirationTtl: SITE_SESSION_TTL,
  });
  return json(request, env, { ok: true, token, expiresAt });
}

async function checkSiteSession(request: Request, env: Env): Promise<Response> {
  if (!await siteAuthorized(request, env)) return json(request, env, { ok: false }, 401);
  return json(request, env, { ok: true });
}

async function getPreferences(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env) && !await siteAuthorized(request, env)) {
    return json(request, env, { message: "Unauthorized" }, 401);
  }
  const row = await env.JOB_DB.prepare(
    "SELECT custom_requirement AS customRequirement, updated_at AS updatedAt FROM user_preferences WHERE id = 1",
  ).first<{ customRequirement: string; updatedAt: string }>();
  return json(request, env, {
    customRequirement: row?.customRequirement || "",
    updatedAt: row?.updatedAt || null,
  });
}

async function savePreferences(request: Request, env: Env): Promise<Response> {
  if (!await siteAuthorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const body = await request.json<{ customRequirement?: string }>().catch(() => ({ customRequirement: "" }));
  const customRequirement = String(body.customRequirement || "").trim();
  if (customRequirement.length > 2_000) return json(request, env, { message: "自定义要求不能超过 2000 字" }, 400);
  const updatedAt = new Date().toISOString();
  await env.JOB_DB.prepare(`INSERT INTO user_preferences (id, custom_requirement, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET custom_requirement=excluded.custom_requirement, updated_at=excluded.updated_at`)
    .bind(customRequirement, updatedAt).run();
  return json(request, env, { ok: true, customRequirement, updatedAt });
}

function managedAccountFromRow(row: any): ManagedAccount {
  return {
    fakeid: String(row.fakeid || ""),
    name: String(row.name || ""),
    alias: String(row.alias || ""),
    avatarUrl: String(row.avatar_url || ""),
    status: row.status === "paused" || row.status === "removed" ? row.status : "active",
    source: ["bootstrap", "name_search", "article_url", "manual"].includes(row.source) ? row.source : "name_search",
    addedAt: String(row.added_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

async function listManagedAccounts(request: Request, env: Env): Promise<Response> {
  const collector = authorized(request, env);
  if (!collector && !await siteAuthorized(request, env)) {
    return json(request, env, { message: "Unauthorized" }, 401);
  }
  const where = collector ? "status = 'active'" : "status != 'removed'";
  const result = await env.JOB_DB.prepare(`SELECT * FROM monitored_accounts
    WHERE ${where} ORDER BY status = 'active' DESC, name COLLATE NOCASE`).all();
  const accounts = (result.results || []).map(managedAccountFromRow);
  return json(request, env, {
    count: accounts.length,
    activeCount: accounts.filter(account => account.status === "active").length,
    accounts,
  });
}

function cleanHttpsUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isExpiredWechatCode(code: number): boolean {
  return [-1, 200003, 200013].includes(code);
}

async function searchManagedAccounts(request: Request, env: Env): Promise<Response> {
  if (!await siteAuthorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const auth = await getAuth(env);
  if (!auth) return json(request, env, { message: "微信公众号授权已过期，请先扫码恢复授权" }, 409);
  const body = await request.json<{ keyword?: string }>().catch(() => ({ keyword: "" }));
  const keyword = String(body.keyword || "").trim();
  if (keyword.length < 2 || keyword.length > 80) {
    return json(request, env, { message: "请输入 2 至 80 个字符的公众号名称" }, 400);
  }

  const url = new URL("https://mp.weixin.qq.com/cgi-bin/searchbiz");
  const params: Record<string, string> = {
    action: "search_biz",
    begin: "0",
    count: "10",
    query: keyword,
    token: auth.token,
    lang: "zh_CN",
    f: "json",
    ajax: "1",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: mpHeaders(cookieHeader(auth.cookies)) });
  const result: any = await response.json().catch(() => null);
  if (!response.ok || !result) return json(request, env, { message: "微信公众号搜索接口返回异常" }, 502);
  const ret = Number(result?.base_resp?.ret ?? -1);
  if (ret !== 0) {
    if (isExpiredWechatCode(ret)) await env.AUTH_KV.delete(AUTH_KEY);
    return json(request, env, { message: result?.base_resp?.err_msg || `公众号搜索失败（${ret}）` }, isExpiredWechatCode(ret) ? 409 : 502);
  }

  const rawCandidates = Array.isArray(result.list) ? result.list : [];
  const seen = new Set<string>();
  const candidates: Array<SearchCandidate & { candidateId: string; status: ManagedAccount["status"] | null }> = [];
  for (const raw of rawCandidates.slice(0, 10)) {
    const fakeid = String(raw?.fakeid || "").trim();
    const name = String(raw?.nickname || raw?.name || "").trim();
    if (!fakeid || !name || seen.has(fakeid)) continue;
    seen.add(fakeid);
    const candidate: SearchCandidate = {
      fakeid,
      name,
      alias: String(raw?.alias || "").trim(),
      avatarUrl: cleanHttpsUrl(raw?.round_head_img || raw?.head_img),
    };
    const candidateId = randomToken();
    const existing = await env.JOB_DB.prepare("SELECT status FROM monitored_accounts WHERE fakeid = ?")
      .bind(fakeid).first<{ status: ManagedAccount["status"] }>();
    await env.AUTH_KV.put(`${ACCOUNT_SEARCH_PREFIX}${candidateId}`, JSON.stringify(candidate), { expirationTtl: 10 * 60 });
    candidates.push({ ...candidate, fakeid: "", candidateId, status: existing?.status || null });
  }
  return json(request, env, { keyword, candidates });
}

async function addManagedAccount(request: Request, env: Env): Promise<Response> {
  if (!await siteAuthorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const body = await request.json<{ candidateId?: string }>().catch(() => ({ candidateId: "" }));
  const candidateId = String(body.candidateId || "");
  if (!/^[a-f0-9]{64}$/.test(candidateId)) return json(request, env, { message: "搜索结果标识不合法" }, 400);
  const candidate = await env.AUTH_KV.get<SearchCandidate>(`${ACCOUNT_SEARCH_PREFIX}${candidateId}`, "json");
  if (!candidate) return json(request, env, { message: "搜索结果已过期，请重新搜索" }, 410);
  const now = new Date().toISOString();
  await env.JOB_DB.prepare(`INSERT INTO monitored_accounts
    (fakeid, name, alias, avatar_url, status, source, added_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', 'name_search', ?, ?)
    ON CONFLICT(fakeid) DO UPDATE SET
      name=excluded.name, alias=excluded.alias, avatar_url=excluded.avatar_url,
      status='active', source='name_search', updated_at=excluded.updated_at`)
    .bind(candidate.fakeid, candidate.name, candidate.alias, candidate.avatarUrl, now, now).run();
  await env.AUTH_KV.delete(`${ACCOUNT_SEARCH_PREFIX}${candidateId}`);
  const row = await env.JOB_DB.prepare("SELECT * FROM monitored_accounts WHERE fakeid = ?")
    .bind(candidate.fakeid).first();
  await dispatchCollection(env).catch(() => undefined);
  return json(request, env, { ok: true, account: managedAccountFromRow(row) });
}

async function updateManagedAccount(request: Request, env: Env, fakeid: string): Promise<Response> {
  if (!await siteAuthorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const body = await request.json<{ status?: string }>().catch(() => ({ status: "" }));
  if (body.status !== "active" && body.status !== "paused") {
    return json(request, env, { message: "状态只能是 active 或 paused" }, 400);
  }
  const result = await env.JOB_DB.prepare("UPDATE monitored_accounts SET status = ?, updated_at = ? WHERE fakeid = ? AND status != 'removed'")
    .bind(body.status, new Date().toISOString(), fakeid).run();
  if (!result.meta.changes) return json(request, env, { message: "没有找到该公众号" }, 404);
  const row = await env.JOB_DB.prepare("SELECT * FROM monitored_accounts WHERE fakeid = ?").bind(fakeid).first();
  return json(request, env, { ok: true, account: managedAccountFromRow(row) });
}

async function removeManagedAccount(request: Request, env: Env, fakeid: string): Promise<Response> {
  if (!await siteAuthorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const result = await env.JOB_DB.prepare("UPDATE monitored_accounts SET status = 'removed', updated_at = ? WHERE fakeid = ? AND status != 'removed'")
    .bind(new Date().toISOString(), fakeid).run();
  if (!result.meta.changes) return json(request, env, { message: "没有找到该公众号" }, 404);
  return json(request, env, { ok: true });
}

function mpHeaders(cookie?: string): Headers {
  const headers = new Headers({
    Referer: "https://mp.weixin.qq.com/",
    Origin: "https://mp.weixin.qq.com",
    "User-Agent": USER_AGENT,
    "Accept-Encoding": "identity",
  });
  if (cookie) headers.set("Cookie", cookie);
  return headers;
}

function splitSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,=]+=[^;,]+)/g).map(item => item.trim()).filter(Boolean);
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const direct = headers.getSetCookie?.();
  if (direct?.length) return direct;
  const combined = response.headers.get("set-cookie");
  return combined ? splitSetCookie(combined) : [];
}

function cookieNameValue(setCookie: string): string | null {
  const first = setCookie.split(";", 1)[0]?.trim();
  return first && first.includes("=") ? first : null;
}

function cookieHeader(cookies: string[]): string {
  const byName = new Map<string, string>();
  for (const cookie of cookies) {
    const pair = cookieNameValue(cookie);
    if (!pair) continue;
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (value && value !== "EXPIRED") byName.set(name, pair);
  }
  return [...byName.values()].join("; ");
}

async function getAuth(env: Env): Promise<StoredAuth | null> {
  const auth = await env.AUTH_KV.get<StoredAuth>(AUTH_KEY, "json");
  if (!auth || Date.parse(auth.expiresAt) <= Date.now()) return null;
  return auth;
}

async function startLogin(env: Env): Promise<LoginSession> {
  const id = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const body = new URLSearchParams({
    userlang: "zh_CN",
    redirect_url: "",
    login_type: "3",
    sessionid: id,
    token: "",
    lang: "zh_CN",
    f: "json",
    ajax: "1",
  });
  const response = await fetch("https://mp.weixin.qq.com/cgi-bin/bizlogin?action=startlogin", {
    method: "POST",
    headers: mpHeaders(),
    body,
  });
  const result: any = await response.clone().json().catch(() => null);
  if (!response.ok || result?.base_resp?.ret !== 0) {
    throw new Error(result?.base_resp?.err_msg || `微信登录会话创建失败（HTTP ${response.status}）`);
  }
  const uuidCookie = getSetCookies(response).map(cookieNameValue).find(cookie => cookie?.startsWith("uuid="));
  if (!uuidCookie) throw new Error("微信响应中没有 uuid cookie");
  const session: LoginSession = {
    id: crypto.randomUUID(),
    uuidCookie,
    createdAt: new Date().toISOString(),
    status: 0,
  };
  await env.AUTH_KV.put(LOGIN_KEY, JSON.stringify(session), { expirationTtl: 30 * 60 });
  return session;
}

async function getLoginSession(env: Env): Promise<LoginSession | null> {
  return env.AUTH_KV.get<LoginSession>(LOGIN_KEY, "json");
}

async function finishLogin(env: Env, session: LoginSession): Promise<StoredAuth> {
  const body = new URLSearchParams({
    userlang: "zh_CN",
    redirect_url: "",
    cookie_forbidden: "0",
    cookie_cleaned: "0",
    plugin_used: "0",
    login_type: "3",
    token: "",
    lang: "zh_CN",
    f: "json",
    ajax: "1",
  });
  const response = await fetch("https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login", {
    method: "POST",
    headers: mpHeaders(session.uuidCookie),
    body,
  });
  const result: any = await response.clone().json().catch(() => null);
  const redirectUrl = result?.redirect_url;
  if (!response.ok || !redirectUrl) {
    throw new Error(result?.base_resp?.err_msg || `微信登录确认失败（HTTP ${response.status}）`);
  }
  const token = new URL(redirectUrl, "https://mp.weixin.qq.com").searchParams.get("token");
  if (!token) throw new Error("登录响应中缺少公众号 token");
  const cookies = getSetCookies(response);
  if (!cookies.length) throw new Error("登录响应中缺少公众号 cookie");
  const now = Date.now();
  const auth: StoredAuth = {
    token,
    cookies,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + FOUR_DAYS_MS).toISOString(),
  };
  await env.AUTH_KV.put(AUTH_KEY, JSON.stringify(auth), { expirationTtl: 4 * 24 * 60 * 60 });
  await env.AUTH_KV.delete(LOGIN_KEY);
  await dispatchCollection(env).catch(() => undefined);
  return auth;
}

async function dispatchCollection(env: Env): Promise<void> {
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPOSITORY) return;
  await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "wx-job-monitor-auth",
    },
    body: JSON.stringify({ event_type: "wechat_auth_refreshed" }),
  });
}

async function publicStatus(request: Request, env: Env): Promise<Response> {
  const [auth, session] = await Promise.all([getAuth(env), getLoginSession(env)]);
  return json(request, env, {
    ok: true,
    auth: { valid: Boolean(auth), expiresAt: auth?.expiresAt || null },
    login: {
      required: !auth,
      qrAvailable: !auth && Boolean(session),
      status: session?.status ?? null,
      createdAt: session?.createdAt || null,
    },
  });
}

async function qrResponse(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(env);
  if (auth) return json(request, env, { message: "授权仍然有效，无需扫码" }, 409);
  let session = await getLoginSession(env);
  if (!session) session = await startLogin(env);
  const url = new URL("https://mp.weixin.qq.com/cgi-bin/scanloginqrcode");
  url.searchParams.set("action", "getqrcode");
  url.searchParams.set("random", Date.now().toString());
  const upstream = await fetch(url, { headers: mpHeaders(session.uuidCookie) });
  if (!upstream.ok) return json(request, env, { message: `二维码获取失败（HTTP ${upstream.status}）` }, 502);
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
  headers.set("Cache-Control", "no-store, max-age=0");
  return new Response(upstream.body, { status: 200, headers });
}

function scanMessage(status: number): string {
  switch (status) {
    case 0: return "等待扫码";
    case 1: return "已确认，正在完成登录";
    case 4:
    case 6: return "扫码成功，请在微信中确认";
    case 5: return "该账号尚未绑定邮箱";
    default: return "二维码状态已更新";
  }
}

async function pollLogin(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(env);
  if (auth) return json(request, env, { authorized: true, message: "授权有效", expiresAt: auth.expiresAt });
  let session = await getLoginSession(env);
  if (!session) session = await startLogin(env);
  const url = new URL("https://mp.weixin.qq.com/cgi-bin/scanloginqrcode");
  url.searchParams.set("action", "ask");
  url.searchParams.set("token", "");
  url.searchParams.set("lang", "zh_CN");
  url.searchParams.set("f", "json");
  url.searchParams.set("ajax", "1");
  const response = await fetch(url, { headers: mpHeaders(session.uuidCookie) });
  const result: any = await response.json().catch(() => null);
  if (!response.ok || result?.base_resp?.ret !== 0) {
    return json(request, env, { authorized: false, message: result?.base_resp?.err_msg || "二维码状态查询失败" }, 502);
  }
  const status = Number(result.status ?? 0);
  if (status === 1) {
    const newAuth = await finishLogin(env, session);
    return json(request, env, { authorized: true, message: "授权成功，正在更新今日结果", expiresAt: newAuth.expiresAt });
  }
  if (status === 2 || status === 3) {
    session = await startLogin(env);
    return json(request, env, { authorized: false, refreshQr: true, message: "二维码已刷新", status: session.status });
  }
  session.status = status;
  await env.AUTH_KV.put(LOGIN_KEY, JSON.stringify(session), { expirationTtl: 30 * 60 });
  return json(request, env, {
    authorized: false,
    status,
    message: scanMessage(status),
    accountCount: result.acct_size ?? null,
  });
}

async function listArticles(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const auth = await getAuth(env);
  if (!auth) return json(request, env, { message: "微信公众号授权已过期" }, 401);
  const input = new URL(request.url);
  const fakeid = input.searchParams.get("fakeid") || "";
  if (!fakeid) return json(request, env, { message: "fakeid 不能为空" }, 400);
  const begin = Math.max(0, Number(input.searchParams.get("begin") || 0));
  const size = Math.min(20, Math.max(1, Number(input.searchParams.get("size") || 20)));
  const url = new URL("https://mp.weixin.qq.com/cgi-bin/appmsgpublish");
  const params: Record<string, string> = {
    sub: "list",
    search_field: "null",
    begin: String(begin),
    count: String(size),
    query: "",
    fakeid,
    type: "101_1",
    free_publish_type: "1",
    sub_action: "list_ex",
    token: auth.token,
    lang: "zh_CN",
    f: "json",
    ajax: "1",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: mpHeaders(cookieHeader(auth.cookies)) });
  const result: any = await response.json().catch(() => null);
  if (!response.ok || !result) return json(request, env, { message: "微信文章接口返回异常" }, 502);
  if (result?.base_resp?.ret !== 0) {
    if (isExpiredWechatCode(Number(result?.base_resp?.ret))) await env.AUTH_KV.delete(AUTH_KEY);
    return json(request, env, result, 200);
  }
  try {
    const page = JSON.parse(result.publish_page);
    const articles = (page.publish_list || [])
      .filter((item: any) => Boolean(item.publish_info))
      .flatMap((item: any) => JSON.parse(item.publish_info).appmsgex || []);
    return json(request, env, { base_resp: result.base_resp, articles });
  } catch {
    return json(request, env, { message: "微信文章列表解析失败" }, 502);
  }
}

async function downloadArticle(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const input = new URL(request.url);
  const raw = input.searchParams.get("url") || "";
  let articleUrl: URL;
  try {
    articleUrl = new URL(raw);
  } catch {
    return json(request, env, { message: "文章 URL 不合法" }, 400);
  }
  if (articleUrl.protocol !== "https:" || articleUrl.hostname !== "mp.weixin.qq.com" || !articleUrl.pathname.startsWith("/s")) {
    return json(request, env, { message: "只允许下载 mp.weixin.qq.com 文章" }, 400);
  }
  const upstream = await fetch(articleUrl, { headers: mpHeaders() });
  if (!upstream.ok) return json(request, env, { message: `微信文章下载失败（HTTP ${upstream.status}）` }, 502);
  const html = await upstream.text();
  if (!html.includes("js_article") && !html.includes("cgiDataNew")) {
    return json(request, env, { message: "微信返回了验证页或空页面" }, 502);
  }
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(html, { status: 200, headers });
}

function jsonText(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function parseJsonArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function jobFromRow(row: any): any {
  return {
    id: row.id,
    articleId: row.article_id,
    account: row.account,
    organization: row.organization,
    organizationNature: row.organization_nature || "未披露",
    industry: row.industry || "未披露",
    jobTitle: row.job_title,
    jobDirections: parseJsonArray(row.job_directions_json),
    locations: parseJsonArray(row.locations_json),
    headcount: row.headcount,
    employmentTypes: parseJsonArray(row.employment_types_json),
    graduateScope: row.graduate_scope || "未明确",
    previousGraduatesEligible: row.previous_graduates_eligible || "uncertain",
    education: { summary: row.education_summary, minimum: row.education_minimum, preferred: row.education_preferred, tier: row.education_tier, hardPhdRequired: Boolean(row.hard_phd_required) },
    majors: { summary: row.major_summary, accepted: parseJsonArray(row.accepted_majors_json), fit: row.major_fit },
    applicationRequirements: parseJsonArray(row.application_requirements_json),
    compensation: { summary: row.compensation_summary, salary: row.salary, benefits: parseJsonArray(row.benefits_json), quality: row.compensation_quality },
    deadline: row.deadline,
    applicationMethod: row.application_method,
    applicationUrl: row.application_url,
    referralCode: row.referral_code,
    recommendation: { score: row.recommendation_score, rankingKey: row.ranking_key, level: row.recommendation_level, reasons: parseJsonArray(row.recommendation_reasons_json), concerns: parseJsonArray(row.concerns_json) },
    customRequirement: parseJsonObject(row.custom_requirement_json),
    personalized: parseJsonObject(row.personalized_json),
    evidence: parseJsonArray(row.evidence_json),
    confidence: row.confidence,
    article: { title: row.article_title, url: row.article_url, publishedAt: row.published_at, summary: row.article_summary, ocrUsed: Boolean(row.ocr_used), ocrImageCount: row.ocr_image_count, analysisSource: row.analysis_source, extractionComplete: Boolean(row.extraction_complete) },
  };
}

const JOB_SELECT = `SELECT p.*, a.title AS article_title, a.url AS article_url,
  a.published_at, a.summary AS article_summary, a.ocr_used, a.ocr_image_count,
  a.analysis_source, a.extraction_complete, pp.custom_requirement_json,
  pp.personalized_json, pp.personalized_eligible, pp.personalized_ranking_key
  FROM positions p JOIN articles a ON a.id = p.article_id
  LEFT JOIN position_personalization pp ON pp.position_id = p.id`;

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("；") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function previousGraduateLabel(value: unknown): string {
  return value === "yes" ? "是" : value === "no" ? "否" : "未明确";
}

function historyCsvResponse(request: Request, env: Env, rows: any[]): Response {
  const headers = [
    "公众号", "更新日期", "企业性质", "公司/单位名称", "招聘类型", "行业", "推文标题",
    "招聘岗位", "岗位方向", "专业要求", "地点", "原文链接", "网申地址", "截止日期",
    "往届是否可投递", "学历要求", "适用届别", "内推码", "报考要求", "薪资", "福利待遇",
    "推荐分数", "推荐等级", "推荐理由", "不推荐理由", "招聘人数", "报名方式", "AI置信度",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    const job = jobFromRow(row);
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
  const headersOut = corsHeaders(request, env);
  headersOut.set("Content-Type", "text/csv; charset=utf-8");
  headersOut.set("Content-Disposition", "attachment; filename*=UTF-8''wechat-job-history.csv");
  headersOut.set("Cache-Control", "public, max-age=300");
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, { status: 200, headers: headersOut });
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[], size = 50): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

async function saveReport(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 8 * 1024 * 1024) return json(request, env, { message: "报告超过 8MB" }, 413);
  const report = await request.json<ReportPayload>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report?.date || "") || !Array.isArray(report?.items)) {
    return json(request, env, { message: "报告格式不合法" }, 400);
  }
  const stats = report.stats || {};
  const now = new Date().toISOString();
  await env.JOB_DB.batch([
    env.JOB_DB.prepare("DELETE FROM positions WHERE report_date = ?").bind(report.date),
    env.JOB_DB.prepare("DELETE FROM articles WHERE report_date = ?").bind(report.date),
    env.JOB_DB.prepare(`INSERT INTO report_days (
      report_date, generated_at, accounts_configured, accounts_succeeded, articles_scanned,
      new_articles, candidate_articles, relevant_articles, positions_extracted, failed_articles, errors_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_date) DO UPDATE SET
      generated_at=excluded.generated_at, accounts_configured=excluded.accounts_configured,
      accounts_succeeded=excluded.accounts_succeeded, articles_scanned=excluded.articles_scanned,
      new_articles=excluded.new_articles, candidate_articles=excluded.candidate_articles,
      relevant_articles=excluded.relevant_articles, positions_extracted=excluded.positions_extracted,
      failed_articles=excluded.failed_articles, errors_json=excluded.errors_json`).bind(
      report.date, report.generatedAt, stats.accountsConfigured || 0, stats.accountsSucceeded || 0,
      stats.articlesScanned || 0, stats.newArticles || 0, stats.candidateArticles || 0,
      stats.relevantArticles || 0, stats.positionsExtracted || 0, stats.failedArticles || 0,
      jsonText(report.errors),
    ),
  ]);

  const articleStatements: D1PreparedStatement[] = [];
  const positionStatements: D1PreparedStatement[] = [];
  const personalizationStatements: D1PreparedStatement[] = [];
  for (const item of report.items) {
    if (!item?.id || !item?.url || !item?.title) continue;
    articleStatements.push(env.JOB_DB.prepare(`INSERT INTO articles (
      id, report_date, account, title, url, published_at, summary, ocr_used, ocr_image_count,
      analysis_source, extraction_complete, notes_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).bind(
      item.id, report.date, item.account || "", item.title, item.url, item.publishedAt || report.generatedAt,
      item.summary || "", item.ocrUsed ? 1 : 0, item.ocrImageCount || 0,
      item.analysisSource || "heuristic", item.extractionComplete ? 1 : 0, jsonText(item.notes), now,
    ));
    for (const position of Array.isArray(item.positions) ? item.positions : []) {
      if (!position?.id || !position?.jobTitle) continue;
      positionStatements.push(env.JOB_DB.prepare(`INSERT INTO positions (
        id, article_id, report_date, account, organization, organization_nature, industry, job_title,
        job_directions_json, locations_json, headcount, employment_types_json, graduate_scope,
        previous_graduates_eligible, education_summary, education_minimum, education_preferred,
        education_tier, hard_phd_required, major_summary, accepted_majors_json, major_fit,
        application_requirements_json, compensation_summary, salary, benefits_json,
        compensation_quality, deadline, application_method, application_url, referral_code,
        recommendation_score, ranking_key, recommendation_level, recommendation_reasons_json, concerns_json,
        evidence_json, confidence, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).bind(
        position.id, item.id, report.date, item.account || "", position.organization || "未明确单位",
        position.organizationNature || "未披露", position.industry || "未披露", position.jobTitle,
        jsonText(position.jobDirections), jsonText(position.locations), position.headcount || null,
        jsonText(position.employmentTypes), position.graduateScope || "未明确",
        position.previousGraduatesEligible || "uncertain",
        position.education?.summary || "未明确", position.education?.minimum || null,
        position.education?.preferred || null, position.education?.tier || "unspecified",
        position.education?.hardPhdRequired ? 1 : 0, position.majors?.summary || "未明确",
        jsonText(position.majors?.accepted), position.majors?.fit || "uncertain",
        jsonText(position.applicationRequirements), position.compensation?.summary || "未披露",
        position.compensation?.salary || null, jsonText(position.compensation?.benefits),
        position.compensation?.quality || 0, position.deadline || null, position.applicationMethod || null,
        position.applicationUrl || null, position.referralCode || null,
        position.recommendation?.score || 0, position.recommendation?.rankingKey || 0,
        position.recommendation?.level || "low", jsonText(position.recommendation?.reasons),
        jsonText(position.recommendation?.concerns), jsonText(position.evidence), position.confidence || 0, now,
      ));
      personalizationStatements.push(env.JOB_DB.prepare(`INSERT INTO position_personalization (
        position_id, custom_requirement_json, personalized_json, personalized_eligible,
        personalized_ranking_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(position_id) DO UPDATE SET
        custom_requirement_json=excluded.custom_requirement_json,
        personalized_json=excluded.personalized_json,
        personalized_eligible=excluded.personalized_eligible,
        personalized_ranking_key=excluded.personalized_ranking_key,
        updated_at=excluded.updated_at`).bind(
        position.id, JSON.stringify(position.customRequirement || {}), JSON.stringify(position.personalized || {}),
        position.personalized?.eligible ? 1 : 0, position.personalized?.rankingKey || 0, now,
      ));
    }
  }
  await runBatches(env.JOB_DB, articleStatements);
  await runBatches(env.JOB_DB, positionStatements);
  await runBatches(env.JOB_DB, personalizationStatements);
  return json(request, env, { ok: true, date: report.date, articles: articleStatements.length, positions: positionStatements.length });
}

async function listJobDays(request: Request, env: Env): Promise<Response> {
  const result = await env.JOB_DB.prepare(`SELECT report_date AS date, generated_at AS generatedAt,
    positions_extracted AS positionCount, articles_scanned AS articlesScanned,
    accounts_succeeded AS accountsSucceeded FROM report_days ORDER BY report_date DESC LIMIT 365`).all();
  return json(request, env, { days: result.results || [] });
}

async function listJobs(request: Request, env: Env): Promise<Response> {
  const input = new URL(request.url);
  let date = input.searchParams.get("date") || "";
  if (!date) {
    const latest = await env.JOB_DB.prepare("SELECT report_date AS date FROM report_days ORDER BY report_date DESC LIMIT 1").first<{ date: string }>();
    date = latest?.date || "";
  }
  if (!date) return json(request, env, { date: null, generatedAt: null, stats: null, jobs: [] });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(request, env, { message: "日期格式不合法" }, 400);
  const limit = Math.min(1000, Math.max(1, Number(input.searchParams.get("limit") || 500)));
  const [day, rows] = await Promise.all([
    env.JOB_DB.prepare("SELECT * FROM report_days WHERE report_date = ?").bind(date).first<any>(),
    env.JOB_DB.prepare(`${JOB_SELECT}
      WHERE p.report_date = ? ORDER BY p.ranking_key DESC, p.recommendation_score DESC LIMIT ?`).bind(date, limit).all<any>(),
  ]);
  const jobs = (rows.results || []).map(jobFromRow);
  return json(request, env, {
    date,
    generatedAt: day?.generated_at || null,
    stats: day ? {
      accountsConfigured: day.accounts_configured, accountsSucceeded: day.accounts_succeeded,
      articlesScanned: day.articles_scanned, newArticles: day.new_articles,
      candidateArticles: day.candidate_articles, relevantArticles: day.relevant_articles,
      positionsExtracted: day.positions_extracted, failedArticles: day.failed_articles,
    } : null,
    jobs,
  });
}

async function listJobHistory(request: Request, env: Env): Promise<Response> {
  const input = new URL(request.url);
  const limit = Math.min(5000, Math.max(1, Number(input.searchParams.get("limit") || 2000)));
  const offset = Math.max(0, Number(input.searchParams.get("offset") || 0));
  const account = (input.searchParams.get("account") || "").trim();
  const where = account ? " WHERE p.account = ?" : "";
  const rowsStatement = env.JOB_DB.prepare(`${JOB_SELECT}${where}
    ORDER BY p.report_date DESC, p.ranking_key DESC, p.recommendation_score DESC LIMIT ? OFFSET ?`);
  const countStatement = env.JOB_DB.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT article_id) AS articles,
    COUNT(DISTINCT account) AS accounts FROM positions${account ? " WHERE account = ?" : ""}`);
  const [rows, counts] = await Promise.all([
    account ? rowsStatement.bind(account, limit, offset).all<any>() : rowsStatement.bind(limit, offset).all<any>(),
    account ? countStatement.bind(account).first<any>() : countStatement.first<any>(),
  ]);
  return json(request, env, {
    date: "all",
    generatedAt: new Date().toISOString(),
    total: Number(counts?.total || 0),
    stats: {
      accountsConfigured: Number(counts?.accounts || 0),
      accountsSucceeded: Number(counts?.accounts || 0),
      articlesScanned: Number(counts?.articles || 0),
      newArticles: Number(counts?.articles || 0),
      relevantArticles: Number(counts?.articles || 0),
      positionsExtracted: Number(counts?.total || 0),
      failedArticles: 0,
    },
    jobs: (rows.results || []).map(jobFromRow),
  });
}

async function downloadJobHistoryCsv(request: Request, env: Env): Promise<Response> {
  const allRows: any[] = [];
  let offset = 0;
  const batchSize = 5000;
  while (true) {
    const rows = await env.JOB_DB.prepare(`${JOB_SELECT}
      ORDER BY p.report_date DESC, p.ranking_key DESC, p.recommendation_score DESC
      LIMIT ? OFFSET ?`).bind(batchSize, offset).all<any>();
    const batch = rows.results || [];
    allRows.push(...batch);
    if (batch.length < batchSize) break;
    offset += batch.length;
  }
  return historyCsvResponse(request, env, allRows);
}

async function listQualityPool(request: Request, env: Env): Promise<Response> {
  const rows = await env.JOB_DB.prepare(`${JOB_SELECT}
    WHERE pp.personalized_eligible = 1
    ORDER BY pp.personalized_ranking_key DESC, p.report_date DESC LIMIT 30`).all<any>();
  const jobs = (rows.results || []).map(jobFromRow);
  return json(request, env, { generatedAt: new Date().toISOString(), maxSize: 30, total: jobs.length, jobs });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json(request, env, { ok: true });
      await ensureRuntimeSchema(env);
      if (url.pathname === "/api/site/login" && request.method === "POST") return loginSite(request, env);
      if (url.pathname === "/api/site/session" && request.method === "GET") return checkSiteSession(request, env);
      if (url.pathname === "/api/preferences" && request.method === "GET") return getPreferences(request, env);
      if (url.pathname === "/api/preferences" && request.method === "PUT") return savePreferences(request, env);
      if (url.pathname === "/api/accounts/search" && request.method === "POST") return searchManagedAccounts(request, env);
      if (url.pathname === "/api/accounts" && request.method === "GET") return listManagedAccounts(request, env);
      if (url.pathname === "/api/accounts" && request.method === "POST") return addManagedAccount(request, env);
      const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
      if (accountMatch && request.method === "PUT") return updateManagedAccount(request, env, decodeURIComponent(accountMatch[1]));
      if (accountMatch && request.method === "DELETE") return removeManagedAccount(request, env, decodeURIComponent(accountMatch[1]));
      if (url.pathname === "/api/status" && request.method === "GET") return publicStatus(request, env);
      if (url.pathname === "/api/auth/start" && request.method === "POST") {
        if (!authorized(request, env)) return json(request, env, { message: "Unauthorized" }, 401);
        const session = await startLogin(env);
        return json(request, env, { ok: true, createdAt: session.createdAt, qrAvailable: true });
      }
      if (url.pathname === "/api/auth/qr" && request.method === "GET") return qrResponse(request, env);
      if (url.pathname === "/api/auth/poll" && request.method === "GET") return pollLogin(request, env);
      if (url.pathname === "/api/exporter/articles" && request.method === "GET") return listArticles(request, env);
      if (url.pathname === "/api/exporter/content" && request.method === "GET") return downloadArticle(request, env);
      if (url.pathname === "/api/reports" && request.method === "POST") return saveReport(request, env);
      if (url.pathname === "/api/job-days" && request.method === "GET") return listJobDays(request, env);
      if (url.pathname === "/api/jobs" && request.method === "GET") return listJobs(request, env);
      if (url.pathname === "/api/job-history" && request.method === "GET") return listJobHistory(request, env);
      if (url.pathname === "/api/jobs.csv" && request.method === "GET") return downloadJobHistoryCsv(request, env);
      if (url.pathname === "/api/quality-pool" && request.method === "GET") return listQualityPool(request, env);
      return json(request, env, { message: "Not found" }, 404);
    } catch (error) {
      return json(request, env, { message: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
