interface Env {
  AUTH_KV: KVNamespace;
  COLLECTOR_TOKEN: string;
  ALLOWED_ORIGIN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_DISPATCH_TOKEN?: string;
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

const LOGIN_KEY = "login:current";
const AUTH_KEY = "auth:current";
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function corsHeaders(request: Request, env: Env): Headers {
  const requestOrigin = request.headers.get("Origin") || "";
  const configured = env.ALLOWED_ORIGIN || "*";
  const allowOrigin = configured === "*" || configured.split(",").map(item => item.trim()).includes(requestOrigin)
    ? configured === "*" ? "*" : requestOrigin
    : "null";
  return new Headers({
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    if ([-1, 200003, 200013].includes(Number(result?.base_resp?.ret))) await env.AUTH_KV.delete(AUTH_KEY);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json(request, env, { ok: true });
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
      return json(request, env, { message: "Not found" }, 404);
    } catch (error) {
      return json(request, env, { message: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
