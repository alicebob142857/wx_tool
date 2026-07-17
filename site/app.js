const state = { index: null, report: null, status: null, runtime: null, account: "", query: "" };

const $ = selector => document.querySelector(selector);
const text = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };

async function getJson(url, fallback = null) {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`无法读取 ${url}`, error);
    return fallback;
  }
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
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
}

function setServiceStatus(kind, label) {
  const node = $("#service-status");
  node.className = `service-status is-${kind}`;
  node.lastElementChild.textContent = label;
}

function updateStats(stats) {
  text("#stat-accounts", stats ? `${stats.accountsSucceeded}/${stats.accountsConfigured}` : "—");
  text("#stat-articles", stats?.articlesScanned ?? "—");
  text("#stat-new", stats?.newArticles ?? "—");
  text("#stat-relevant", stats?.relevantArticles ?? "—");
}

function chip(label, extra = "") {
  const span = document.createElement("span");
  span.className = `chip ${extra}`.trim();
  span.textContent = label;
  return span;
}

function renderResults() {
  const container = $("#results");
  container.replaceChildren();
  const items = state.report?.items || [];
  const query = state.query.toLowerCase();
  const filtered = items.filter(item => {
    if (state.account && item.account !== state.account) return false;
    if (!query) return true;
    return [item.title, item.summary, item.account, ...(item.suitableMajors || []), ...(item.locations || [])]
      .join(" ").toLowerCase().includes(query);
  });

  for (const item of filtered) {
    const card = document.createElement("article");
    card.className = "job-card";

    const source = document.createElement("div");
    source.innerHTML = `<span class="job-source"></span><span class="job-date"></span>`;
    source.querySelector(".job-source").textContent = item.account;
    source.querySelector(".job-date").textContent = fmtDateTime(item.publishedAt);

    const body = document.createElement("div");
    body.className = "job-body";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const summary = document.createElement("p");
    summary.textContent = item.summary || "AI 已判定该信息与文科或管理类毕业生相关。";
    const chips = document.createElement("div");
    chips.className = "chips";
    [...(item.jobTypes || []), ...(item.suitableMajors || []).slice(0, 6), ...(item.locations || []).slice(0, 3)]
      .filter(Boolean).forEach(label => chips.append(chip(label)));
    if (item.graduateScope && item.graduateScope !== "未明确") chips.append(chip(item.graduateScope));
    if (item.ocrUsed) chips.append(chip(`OCR ${item.ocrImageCount} 图`, "ocr"));
    body.append(title, summary, chips);

    const action = document.createElement("div");
    action.className = "job-action";
    const link = document.createElement("a");
    link.className = "job-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看原文 ↗";
    const confidence = document.createElement("span");
    confidence.className = "confidence";
    confidence.textContent = `置信度 ${Math.round((item.confidence || 0) * 100)}%`;
    action.append(link, confidence);

    card.append(source, body, action);
    container.append(card);
  }
  text("#result-count", `${filtered.length} 条结果`);
  $("#empty-state").hidden = filtered.length !== 0;
}

function populateAccounts() {
  const select = $("#account-select");
  while (select.options.length > 1) select.remove(1);
  const accounts = [...new Set((state.report?.items || []).map(item => item.account))].sort();
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account;
    option.textContent = account;
    select.append(option);
  }
}

async function loadReport(date) {
  if (!date) {
    state.report = { items: [], stats: state.status?.stats || null };
  } else {
    state.report = await getJson(`data/daily/${date}.json`, { date, items: [], stats: state.status?.stats || null });
  }
  text("#current-date", fmtDate(date));
  text("#last-run", state.report?.generatedAt ? `完成于 ${fmtDateTime(state.report.generatedAt)}` : "等待首次采集");
  updateStats(state.report?.stats || state.status?.stats);
  populateAccounts();
  renderResults();
}

async function setupDates() {
  const select = $("#date-select");
  select.replaceChildren();
  const days = state.index?.days || [];
  if (!days.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无报告";
    select.append(option);
    await loadReport("");
    return;
  }
  for (const day of days) {
    const option = document.createElement("option");
    option.value = day.date;
    option.textContent = `${day.date} · ${day.relevantCount} 条`;
    select.append(option);
  }
  await loadReport(days[0].date);
}

function showAuthPanel(message) {
  $("#auth-panel").hidden = false;
  if (message) text("#auth-message", message);
}

function hideAuthPanel() {
  $("#auth-panel").hidden = true;
}

async function monitorRemoteAuth() {
  const base = state.runtime?.authServiceUrl?.replace(/\/$/, "");
  if (!base) {
    if (state.status?.state === "auth_required") {
      showAuthPanel("授权已过期，但登录服务尚未部署。请完成 Cloudflare Worker 配置。");
      text("#scan-status", "登录服务未配置");
    }
    return;
  }
  const remote = await getJson(`${base}/api/status`);
  if (!remote) return;
  if (remote.auth?.valid) {
    hideAuthPanel();
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
    if (!result) {
      text("#scan-status", "暂时无法查询扫码状态");
      return setTimeout(poll, 4000);
    }
    text("#scan-status", result.message || "等待扫码");
    if (result.authorized) {
      setServiceStatus("ok", "授权已恢复");
      text("#auth-message", "授权成功。系统正在重新运行今日采集任务，稍后刷新页面即可看到结果。");
      qr.hidden = true;
      $("#qr-placeholder").hidden = false;
      $("#qr-placeholder").textContent = "✓ 授权成功";
      return;
    }
    if (result.refreshQr) qr.src = `${base}/api/auth/qr?v=${Date.now()}`;
    setTimeout(poll, 2500);
  };
  setTimeout(poll, 2000);
}

async function init() {
  [state.status, state.runtime, state.index] = await Promise.all([
    getJson("data/status.json", { state: "never_run", auth: { status: "unknown" }, stats: null }),
    getJson("data/runtime.json", { authServiceUrl: "" }),
    getJson("data/index.json", { days: [] }),
  ]);
  text("#footer-meta", state.status?.lastRunAt ? `最后运行：${fmtDateTime(state.status.lastRunAt)}` : "数据由 GitHub Actions 自动生成");
  if (state.status?.state === "ok") setServiceStatus("ok", "今日任务完成");
  else if (state.status?.state === "partial") setServiceStatus("warning", "部分任务失败");
  else if (state.status?.state === "auth_required") setServiceStatus("warning", "授权已过期");
  else if (state.status?.state === "error") setServiceStatus("error", "运行失败");
  else setServiceStatus("loading", "等待首次运行");
  await setupDates();
  await monitorRemoteAuth();
}

$("#date-select").addEventListener("change", event => loadReport(event.target.value));
$("#account-select").addEventListener("change", event => { state.account = event.target.value; renderResults(); });
$("#search-input").addEventListener("input", event => { state.query = event.target.value.trim(); renderResults(); });

init();

