const SESSION_KEY = "wx_job_monitor_site_session";

const state = {
  token: localStorage.getItem(SESSION_KEY) || "",
  runtime: { authServiceUrl: "" },
  status: null,
  index: { days: [] },
  history: { jobs: [] },
  pool: { jobs: [], total: 0, maxSize: 30 },
  profile: null,
  accountsConfig: { count: 0, accounts: [] },
  accountDrafts: [],
  latestDate: "",
  todayJobs: [],
};

const $ = selector => document.querySelector(selector);
const text = (selector, value) => { const element = $(selector); if (element) element.textContent = String(value); };

function node(tag, className = "", content = null) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== null && content !== undefined) element.textContent = String(content);
  return element;
}

async function getJson(url, fallback = null) {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`无法读取 ${url}`, error);
    return fallback;
  }
}

async function apiRequest(path, options = {}) {
  const base = state.runtime?.authServiceUrl?.replace(/\/$/, "");
  if (!base) throw new Error("登录服务尚未配置");
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function fmtDateTime(value) {
  if (!value) return "尚未运行";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(date);
}

function compactText(values, fallback = "未披露") {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return list.length ? list.join("、") : fallback;
}

function setServiceStatus(kind, label) {
  const element = $("#service-status");
  if (!element) return;
  element.className = `service-status is-${kind}`;
  element.lastElementChild.textContent = label;
}

function unlockPage() {
  $("#access-gate").hidden = true;
  $("#app-shell").hidden = false;
}

function showLogin(message, isError = false) {
  $("#access-gate").hidden = false;
  $("#app-shell").hidden = true;
  const status = $("#login-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  if (isError) $("#site-password").focus();
}

function chip(label, extra = "") {
  return node("span", `chip ${extra}`.trim(), label);
}

function fitLabel(value) {
  return ({
    administrative_management: "行政管理匹配",
    management: "其他管理类",
    humanities: "其他文科",
    broad: "专业不限",
    uncertain: "专业待核对",
    mismatch: "专业不匹配",
  })[value] || "专业待核对";
}

function educationLabel(value) {
  return ({
    master: "硕士岗位",
    bachelor_associate: "本科 / 大专层次",
    unspecified: "学历待核对",
    phd_required: "仅博士",
  })[value] || "学历待核对";
}

function previousGraduateLabel(value) {
  return ({ yes: "往届可投", no: "仅限指定届别", uncertain: "往届待核对" })[value] || "往届待核对";
}

function appendList(container, values, emptyText = "原文未披露") {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return container.append(node("p", "detail-empty", emptyText));
  const ul = node("ul", "detail-list");
  list.forEach(value => ul.append(node("li", "", value)));
  container.append(ul);
}

function detailBlock(title, summary, values = []) {
  const block = node("section", "detail-block");
  block.append(node("h4", "", title));
  if (summary) block.append(node("p", "detail-summary", summary));
  appendList(block, values);
  return block;
}

function jobRanking(job) {
  return Number(job.personalized?.rankingKey || job.recommendation?.rankingKey || 0);
}

function sortJobs(jobs) {
  return [...(jobs || [])].sort((a, b) =>
    jobRanking(b) - jobRanking(a)
      || Number(b.personalized?.score || b.recommendation?.score || 0) - Number(a.personalized?.score || a.recommendation?.score || 0)
      || Date.parse(b.article?.publishedAt || 0) - Date.parse(a.article?.publishedAt || 0),
  );
}

function renderProfile() {
  const profile = state.profile || {};
  const container = $("#profile-chips");
  container.replaceChildren(
    chip(profile.school || "北京师范大学", "profile-chip"),
    chip(profile.education || "硕士研究生", "profile-chip"),
    chip(`${profile.major || "行政管理"}专业`, "profile-chip strong"),
    chip(profile.freshGraduate === false ? "非应届" : "应届毕业生", "profile-chip strong"),
  );
}

function renderQualityCard(job) {
  const card = node("article", "job-card quality-card level-high");
  const source = node("div", "job-source-column");
  source.append(node("span", "job-source", job.account || "来源未明确"), node("span", "job-date", job.reportDate || fmtDateTime(job.article?.publishedAt)));

  const body = node("div", "job-body");
  const headingRow = node("div", "job-heading-row");
  const heading = node("div", "job-heading");
  heading.append(node("h3", "", job.jobTitle || "岗位未命名"), node("p", "job-organization", job.organization || "单位未明确"));
  const score = node("div", "score-badge is-high");
  score.append(node("strong", "", job.personalized?.score ?? "—"), node("span", "", "个性化分"));
  headingRow.append(heading, score);

  const chips = node("div", "chips");
  chips.append(chip(fitLabel(job.majors?.fit), `fit-${job.majors?.fit || "uncertain"}`));
  chips.append(chip(educationLabel(job.education?.tier)));
  chips.append(chip(job.graduateScope || "届别未明确"));
  chips.append(chip(job.organizationNature || "单位性质未披露"));
  (job.locations || []).slice(0, 3).forEach(value => chips.append(chip(value)));
  if (job.compensation?.salary) chips.append(chip(job.compensation.salary, "salary"));
  if (job.article?.ocrUsed) chips.append(chip(`OCR ${job.article.ocrImageCount} 图`, "ocr"));

  const verdicts = node("div", "verdicts");
  const pros = node("section", "verdict verdict-pro");
  pros.append(node("h4", "", "为什么推荐"));
  appendList(pros, job.personalized?.reasons, "已通过全部硬条件");
  const concerns = node("section", "verdict verdict-con");
  concerns.append(node("h4", "", "仍需注意"));
  appendList(concerns, job.personalized?.concerns, "暂无明显风险");
  verdicts.append(pros, concerns);

  const details = node("details", "job-details");
  details.append(node("summary", "", "查看岗位、学历、专业、报考条件与待遇"));
  const grid = node("div", "detail-grid");
  grid.append(
    detailBlock("单位与岗位", job.organization || "未明确单位", [
      `企业性质：${job.organizationNature || "未披露"}`,
      `行业：${job.industry || "未披露"}`,
      `岗位方向：${compactText(job.jobDirections)}`,
      `招聘类型：${compactText(job.employmentTypes)}`,
    ]),
    detailBlock("学历与届别", job.education?.summary || "未明确", [
      job.education?.minimum ? `最低：${job.education.minimum}` : "",
      job.education?.preferred ? `优先：${job.education.preferred}` : "",
      `适用届别：${job.graduateScope || "未明确"}`,
      `往届生：${previousGraduateLabel(job.previousGraduatesEligible)}`,
    ]),
    detailBlock("专业要求", job.majors?.summary || "未明确", job.majors?.accepted || []),
    detailBlock("报考要求", null, job.applicationRequirements || []),
    detailBlock("薪资与福利", job.compensation?.summary || "未披露", [
      job.compensation?.salary ? `薪资：${job.compensation.salary}` : "",
      ...(job.compensation?.benefits || []),
    ]),
    detailBlock("报名信息", null, [
      job.headcount ? `人数：${job.headcount}` : "",
      `地点：${compactText(job.locations)}`,
      job.deadline ? `截止：${job.deadline}` : "截止：未披露",
      job.applicationMethod ? `方式：${job.applicationMethod}` : "",
      job.applicationUrl ? `网申：${job.applicationUrl}` : "网申：未披露",
      job.referralCode ? `内推码：${job.referralCode}` : "",
    ]),
  );
  details.append(grid);
  body.append(headingRow, chips, verdicts, details);

  const action = node("div", "job-action");
  const sourceLink = node("a", "job-link", "查看原文 ↗");
  sourceLink.href = job.article?.url || "#";
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener noreferrer";
  action.append(sourceLink);
  if (job.applicationUrl) {
    const applyLink = node("a", "job-link job-apply-link", "立即网申 ↗");
    applyLink.href = job.applicationUrl;
    applyLink.target = "_blank";
    applyLink.rel = "noopener noreferrer";
    action.append(applyLink);
  }
  card.append(source, body, action);
  return card;
}

function renderQualityResults() {
  const quality = sortJobs(state.todayJobs.filter(job => job.personalized?.eligible));
  const container = $("#quality-results");
  container.replaceChildren(...quality.map(renderQualityCard));
  text("#quality-count", `${quality.length} 个`);
  text("#stat-quality-jobs", quality.length);
  $("#quality-empty").hidden = quality.length !== 0;
}

function renderAllJobs() {
  const jobs = sortJobs(state.todayJobs);
  const container = $("#all-jobs-list");
  container.replaceChildren();
  jobs.forEach((job, index) => {
    const row = node("div", `compact-job-row${job.personalized?.eligible ? " is-quality" : ""}`);
    row.setAttribute("role", "row");
    const titleCell = node("span", "compact-title-cell");
    titleCell.append(node("b", "rank-number", index + 1));
    const title = node("a", "compact-job-title", job.jobTitle || "岗位未命名");
    title.href = job.article?.url || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    titleCell.append(title, node("small", "", job.organization || "单位未明确"));
    if (job.personalized?.eligible) titleCell.append(node("em", "quality-label", "优质"));
    row.append(
      titleCell,
      node("span", "", compactText(job.locations, "未披露")),
      node("span", "", job.education?.summary || "未明确"),
      node("span", "", job.deadline || "未披露"),
    );
    container.append(row);
  });
  text("#all-jobs-count", `${jobs.length} 个 · 点击展开`);
  text("#stat-all-jobs", jobs.length);
}

function renderPool() {
  const jobs = sortJobs(state.pool?.jobs || []).slice(0, 30);
  const container = $("#quality-pool-list");
  container.replaceChildren();
  jobs.forEach((job, index) => {
    const row = node("article", "pool-row");
    row.append(node("span", "pool-rank", String(index + 1).padStart(2, "0")));
    const body = node("div", "pool-body");
    const title = node("a", "", job.jobTitle || "岗位未命名");
    title.href = job.article?.url || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    body.append(title, node("small", "", `${job.organization || "单位未明确"} · ${compactText(job.locations)} · ${job.education?.summary || "学历未明确"} · 截止 ${job.deadline || "未披露"}`));
    const score = node("strong", "pool-score", job.personalized?.score ?? "—");
    score.title = "个性化分数";
    row.append(body, score);
    container.append(row);
  });
  if (!jobs.length) container.append(node("p", "pool-empty", "岗位池尚为空，下一次采集后会自动补充。"));
  text("#pool-count", `${jobs.length} / 30`);
}

function updateStats() {
  const stats = state.status?.stats || {};
  text("#stat-accounts", stats.accountsConfigured !== undefined ? `${stats.accountsSucceeded || 0}/${stats.accountsConfigured}` : "—");
  text("#stat-articles", stats.articlesScanned ?? "—");
}

function fullAccountConfig() {
  return [...(state.accountsConfig?.accounts || []), ...state.accountDrafts];
}

function accountConfigJson() {
  return `${JSON.stringify(fullAccountConfig(), null, 2)}\n`;
}

function setAccountFormStatus(message, isError = false) {
  const status = $("#account-form-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function renderManagedAccounts() {
  const container = $("#managed-account-list");
  container.replaceChildren();
  const committed = state.accountsConfig?.accounts || [];
  fullAccountConfig().forEach((account, index) => {
    const draft = index >= committed.length;
    const card = node("article", `managed-account${draft ? " is-draft" : ""}`);
    card.append(node("span", "managed-account-index", index + 1));
    const body = node("div", "managed-account-body");
    const title = node("strong", "", account.name);
    if (draft) title.append(node("span", "draft-label", "待提交"));
    body.append(title, node("code", "", account.fakeid));
    body.append(node("small", "", [account.alias ? `微信号：${account.alias}` : "微信号未填写", account.note || ""].filter(Boolean).join(" · ")));
    card.append(body);
    container.append(card);
  });
  text("#managed-account-count", state.accountDrafts.length ? `${committed.length} 个已生效 · ${state.accountDrafts.length} 个草稿` : `${committed.length} 个已生效`);
  const actions = $("#account-draft-actions");
  actions.hidden = state.accountDrafts.length === 0;
  $("#account-config-preview").value = accountConfigJson();
}

function addAccountDraft(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const account = {
    name: String(data.get("name") || "").trim(),
    fakeid: String(data.get("fakeid") || "").trim(),
    alias: String(data.get("alias") || "").trim(),
    note: String(data.get("note") || "").trim(),
  };
  if (!account.name || !account.fakeid) return setAccountFormStatus("公众号名称和 fakeid 都必须填写。", true);
  if (!/^[A-Za-z0-9+/]{8,}={0,2}$/.test(account.fakeid)) return setAccountFormStatus("fakeid 格式不正确，请不要填写 gh_ 开头的 user_name。", true);
  if (fullAccountConfig().some(value => value.name === account.name || value.fakeid === account.fakeid)) return setAccountFormStatus("名称或 fakeid 已存在。", true);
  if (!account.alias) delete account.alias;
  if (!account.note) delete account.note;
  state.accountDrafts.push(account);
  form.reset();
  renderManagedAccounts();
  setAccountFormStatus(`已把“${account.name}”加入草稿，提交到 GitHub 后生效。`);
}

async function copyAccountConfig() {
  try {
    await navigator.clipboard.writeText(accountConfigJson());
    setAccountFormStatus("完整 accounts.json 已复制。现在到 GitHub 编辑页全选替换并提交。 ");
  } catch {
    const preview = $("#account-config-preview");
    preview.focus(); preview.select(); document.execCommand("copy");
    setAccountFormStatus("完整 accounts.json 已复制。现在到 GitHub 编辑页全选替换并提交。 ");
  }
}

function downloadAccountConfig() {
  const url = URL.createObjectURL(new Blob([accountConfigJson()], { type: "application/json;charset=utf-8" }));
  const link = node("a");
  link.href = url; link.download = "accounts.json";
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  setAccountFormStatus("已下载 accounts.json。 ");
}

async function loadPreferences() {
  const textarea = $("#custom-requirement");
  try {
    const preferences = await apiRequest("/api/preferences");
    textarea.value = preferences.customRequirement || "";
    text("#requirement-status", preferences.updatedAt ? `已保存 · ${fmtDateTime(preferences.updatedAt)}` : "尚未添加自定义要求");
  } catch (error) {
    text("#requirement-status", error.status === 401 ? "登录已失效，请重新验证" : "暂时无法读取已保存要求");
  }
}

async function savePreferences(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const customRequirement = $("#custom-requirement").value.trim();
  button.disabled = true;
  text("#requirement-status", "正在保存…");
  try {
    const result = await apiRequest("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customRequirement }),
    });
    text("#requirement-status", `${result.updatedAt ? `已保存 · ${fmtDateTime(result.updatedAt)}` : "已保存"}；下一次采集开始生效`);
  } catch (error) {
    text("#requirement-status", error.message || "保存失败，请稍后重试");
  } finally {
    button.disabled = false;
  }
}

function showAuthPanel(message) {
  $("#auth-panel").hidden = false;
  if (message) text("#auth-message", message);
}

async function monitorRemoteAuth() {
  const base = state.runtime?.authServiceUrl?.replace(/\/$/, "");
  if (!base) return;
  const remote = await getJson(`${base}/api/status`);
  if (!remote) {
    if (state.status?.state === "auth_required") showAuthPanel("授权服务当前无法访问，请稍后刷新页面。");
    return;
  }
  if (remote.auth?.valid) {
    $("#auth-panel").hidden = true;
    setServiceStatus("ok", "授权正常");
    return;
  }
  showAuthPanel();
  setServiceStatus("warning", "等待扫码授权");
  const qr = $("#auth-qr");
  qr.src = `${base}/api/auth/qr?v=${Date.now()}`;
  qr.hidden = false;
  $("#qr-placeholder").hidden = true;
  const poll = async () => {
    const result = await getJson(`${base}/api/auth/poll`);
    if (!result) return setTimeout(poll, 4_000);
    text("#scan-status", result.message || "等待扫码");
    if (result.authorized) {
      setServiceStatus("ok", "授权已恢复");
      text("#auth-message", "授权成功，系统正在更新结果。");
      qr.hidden = true;
      $("#qr-placeholder").hidden = false;
      $("#qr-placeholder").textContent = "✓ 授权成功";
      return;
    }
    if (result.refreshQr) qr.src = `${base}/api/auth/qr?v=${Date.now()}`;
    setTimeout(poll, 2_500);
  };
  setTimeout(poll, 2_000);
}

async function initApp() {
  [state.status, state.index, state.history, state.pool, state.profile, state.accountsConfig] = await Promise.all([
    getJson("data/status.json", { state: "never_run", stats: null }),
    getJson("data/index.json", { days: [] }),
    getJson("data/job-history.json", { jobs: [] }),
    getJson("data/quality-pool.json", { jobs: [], total: 0, maxSize: 30 }),
    getJson("data/profile.json", { school: "北京师范大学", education: "硕士研究生", major: "行政管理", freshGraduate: true }),
    getJson("data/accounts.json", { count: 0, accounts: [] }),
  ]);
  state.latestDate = state.index?.days?.[0]?.date || [...new Set((state.history?.jobs || []).map(job => job.reportDate).filter(Boolean))].sort().at(-1) || "";
  state.todayJobs = sortJobs((state.history?.jobs || []).filter(job => !state.latestDate || job.reportDate === state.latestDate));
  text("#current-date", fmtDate(state.latestDate));
  text("#last-run", state.status?.lastRunAt ? `完成于 ${fmtDateTime(state.status.lastRunAt)}` : "等待首次采集");
  text("#footer-meta", state.status?.lastRunAt ? `最后运行：${fmtDateTime(state.status.lastRunAt)}` : "数据由 GitHub Actions 自动生成");
  renderProfile();
  updateStats();
  renderQualityResults();
  renderAllJobs();
  renderPool();
  renderManagedAccounts();
  if (state.status?.state === "ok") setServiceStatus("ok", "今日任务完成");
  else if (state.status?.state === "partial") setServiceStatus("warning", "部分任务失败");
  else if (state.status?.state === "auth_required") setServiceStatus("warning", "授权已过期");
  else if (state.status?.state === "error") setServiceStatus("error", "运行失败");
  else setServiceStatus("loading", "等待首次运行");
  await Promise.all([loadPreferences(), monitorRemoteAuth()]);
}

async function restoreOrLogin() {
  state.runtime = await getJson("data/runtime.json", { authServiceUrl: "" });
  if (!state.token) return showLogin("请输入访问密码。 ");
  try {
    await apiRequest("/api/site/session");
    unlockPage();
    await initApp();
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      state.token = "";
      showLogin("浏览器登录已过期，请重新输入密码。", true);
      return;
    }
    unlockPage();
    setServiceStatus("warning", "离线使用已记住浏览器");
    await initApp();
  }
}

async function login(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const password = $("#site-password").value;
  button.disabled = true;
  showLogin("正在验证…");
  try {
    const result = await apiRequest("/api/site/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    state.token = result.token;
    localStorage.setItem(SESSION_KEY, result.token);
    $("#site-password").value = "";
    unlockPage();
    await initApp();
  } catch (error) {
    showLogin(error.message || "验证失败，请重试。", true);
  } finally {
    button.disabled = false;
  }
}

$("#login-form").addEventListener("submit", login);
$("#lock-site").addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  state.token = "";
  location.reload();
});
$("#requirement-form").addEventListener("submit", savePreferences);
$("#account-add-form").addEventListener("submit", addAccountDraft);
$("#copy-account-config").addEventListener("click", copyAccountConfig);
$("#download-account-config").addEventListener("click", downloadAccountConfig);

restoreOrLogin();
