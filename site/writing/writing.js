const writingState = {
  runtime: { authServiceUrl: "" },
  entries: [],
  accounts: [],
  candidates: [],
  total: 0,
  offset: 0,
  limit: 30,
  loading: false,
  qrPollTimer: null,
};

const $ = selector => document.querySelector(selector);

function element(tag, className = "", content = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== null && content !== undefined) node.textContent = String(content);
  return node;
}

function setText(selector, value) {
  const target = $(selector);
  if (target) target.textContent = String(value);
}

async function readJson(url, fallback = null) {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (error) {
    console.warn(`无法读取 ${url}`, error);
    return fallback;
  }
}

async function api(path, options = {}) {
  const base = writingState.runtime.authServiceUrl.replace(/\/$/, "");
  if (!base) throw new Error("后台服务尚未配置");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: new Headers(options.headers || {}),
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
  return payload;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function setServiceStatus(kind, label) {
  const target = $("#writing-service-status");
  if (!target) return;
  target.className = `service-status is-${kind}`;
  target.lastElementChild.textContent = label;
}

function showToast(message, error = false) {
  let toast = $("#writing-toast");
  if (!toast) {
    toast = element("div", "feedback-toast");
    toast.id = "writing-toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("is-error", error);
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2_500);
}

function appendParagraphs(container, text) {
  const paragraphs = String(text || "").split(/\n+/).map(item => item.trim()).filter(Boolean);
  if (!paragraphs.length) {
    container.append(element("p", "", "原文未提取到可展示内容。"));
    return;
  }
  paragraphs.forEach(paragraph => container.append(element("p", "", paragraph)));
}

function renderWritingCard(entry) {
  const card = element("article", "writing-card");
  const header = element("header", "writing-card-header");
  const copy = element("div");
  const meta = element("div", "writing-card-meta");
  meta.append(
    element("span", "writing-account-name", entry.account || "公众号"),
    element("span", "", formatDate(entry.publishedAt)),
    element("span", "", `${Number(entry.wordCount || 0).toLocaleString("zh-CN")} 字`),
    element("span", "", entry.analysisSource === "deepseek" ? "AI 校对拆分" : "规则拆分"),
  );
  copy.append(meta, element("h3", "", entry.essayTitle || entry.articleTitle));
  if (entry.summary) copy.append(element("p", "writing-card-summary", entry.summary));

  const actions = element("div", "writing-card-actions");
  const favorite = element("button", `writing-favorite-button${entry.favorite ? " is-active" : ""}`, entry.favorite ? "★ 已收藏" : "☆ 收藏");
  favorite.type = "button";
  favorite.setAttribute("aria-pressed", String(Boolean(entry.favorite)));
  favorite.addEventListener("click", async () => {
    if (favorite.disabled) return;
    favorite.disabled = true;
    try {
      await api(`/api/writing-favorites/${encodeURIComponent(entry.id)}`, {
        method: entry.favorite ? "DELETE" : "PUT",
      });
      entry.favorite = !entry.favorite;
      if ($("#writing-favorites-only").checked && !entry.favorite) {
        writingState.entries = writingState.entries.filter(item => item.id !== entry.id);
        writingState.total = Math.max(0, writingState.total - 1);
      }
      renderEntries();
      loadWritingStatus();
      showToast(entry.favorite ? "已加入范文收藏" : "已取消收藏");
    } catch (error) {
      showToast(error.message || "收藏操作失败", true);
      favorite.disabled = false;
    }
  });
  const original = element("a", "writing-original-link", "查看原文");
  original.href = entry.articleUrl;
  original.target = "_blank";
  original.rel = "noopener noreferrer";
  actions.append(favorite, original);
  header.append(copy, actions);
  card.append(header);

  const keywords = element("div", "writing-keywords");
  const tags = [entry.theme, ...(entry.keywords || [])].filter(Boolean);
  [...new Set(tags)].slice(0, 10).forEach(tag => keywords.append(element("span", "", tag)));
  if (keywords.childElementCount) card.append(keywords);

  const grid = element("div", "writing-content-grid");
  const essayPane = element("section", "writing-pane essay-pane");
  const essayHeading = element("div", "writing-pane-heading");
  essayHeading.append(element("strong", "", "范文原文"), element("span", "", "已剥离点评与推广内容"));
  const essayText = element("div", "writing-prose");
  appendParagraphs(essayText, entry.essayText);
  essayPane.append(essayHeading, essayText);

  const commentaryPane = element("section", "writing-pane commentary-pane");
  const commentaryHeading = element("div", "writing-pane-heading");
  commentaryHeading.append(
    element("strong", "", "老师点评"),
    element("span", "", `${(entry.commentarySections || []).length} 处解析`),
  );
  const commentaryList = element("div", "writing-prose");
  (entry.commentarySections || []).forEach((section, index) => {
    const block = element("section", "commentary-section");
    block.append(
      element("h4", "", section.sectionTitle || `第 ${index + 1} 处点评`),
      element("p", "", section.commentary || ""),
    );
    commentaryList.append(block);
  });
  if (!commentaryList.childElementCount) appendParagraphs(commentaryList, entry.commentaryText);
  commentaryPane.append(commentaryHeading, commentaryList);
  grid.append(essayPane, commentaryPane);
  card.append(grid);
  if (entry.sourceNote) card.append(element("p", "writing-source-note", `来源说明：${entry.sourceNote}`));
  return card;
}

function renderEntries() {
  const container = $("#writing-results");
  container.replaceChildren(...writingState.entries.map(renderWritingCard));
  $("#writing-empty").hidden = writingState.entries.length > 0 || writingState.loading;
  const hasMore = writingState.entries.length < writingState.total;
  $("#writing-load-more").hidden = !hasMore;
  $("#writing-load-more").disabled = writingState.loading;
  setText("#writing-result-count", `${writingState.total} 篇`);
  const query = $("#writing-query").value.trim();
  setText("#writing-result-title", query ? `“${query}”的检索结果` : $("#writing-favorites-only").checked ? "我的收藏" : "全部范文");
}

async function loadEntries(append = false) {
  if (writingState.loading) return;
  writingState.loading = true;
  if (!append) {
    writingState.offset = 0;
    writingState.entries = [];
  }
  renderEntries();
  const params = new URLSearchParams({
    limit: String(writingState.limit),
    offset: String(writingState.offset),
  });
  const query = $("#writing-query").value.trim();
  const account = $("#writing-account-filter").value;
  if (query) params.set("q", query);
  if (account) params.set("account", account);
  if ($("#writing-favorites-only").checked) params.set("favorite", "1");
  try {
    const result = await api(`/api/writing-entries?${params}`);
    writingState.total = Number(result.total || 0);
    writingState.entries = append
      ? [...writingState.entries, ...(result.entries || [])]
      : (result.entries || []);
    writingState.offset = writingState.entries.length;
  } catch (error) {
    showToast(error.message || "范文读取失败", true);
  } finally {
    writingState.loading = false;
    renderEntries();
  }
}

async function loadWritingStatus() {
  try {
    const result = await api("/api/writing-status");
    setText("#writing-total", Number(result.total || 0));
    setText("#writing-favorite-total", Number(result.favorites || 0));
    setText("#writing-last-date", result.date ? result.date.slice(5).replace("-", "/") : "—");
    setText("#writing-last-run", result.lastRunAt ? `${formatDate(result.lastRunAt, true)} 更新` : "尚未运行");
    setServiceStatus(result.state === "ok" ? "ok" : result.state === "partial" ? "warning" : "loading",
      result.state === "ok" ? "范文库已更新" : result.state === "partial" ? "部分内容待重试" : "等待首次采集");
  } catch {
    setServiceStatus("warning", "范文状态暂不可用");
  }
}

function renderAccountOptions() {
  const select = $("#writing-account-filter");
  const current = select.value;
  select.replaceChildren(element("option", "", "全部公众号"));
  select.firstElementChild.value = "";
  writingState.accounts.filter(item => item.status === "active").forEach(account => {
    const option = element("option", "", account.name);
    option.value = account.fakeid;
    select.append(option);
  });
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function accountActionButton(account, label, action, extraClass = "") {
  const button = element("button", `account-action ${extraClass}`.trim(), label);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
      await loadWritingAccounts();
      await loadEntries();
    } catch (error) {
      showToast(error.message || "公众号操作失败", true);
      button.disabled = false;
    }
  });
  return button;
}

function renderWritingAccounts() {
  const container = $("#writing-account-list");
  container.replaceChildren();
  writingState.accounts.forEach(account => {
    const row = element("article", `managed-account-item${account.status === "paused" ? " is-paused" : ""}`);
    const avatar = element("div", "managed-account-avatar", (account.name || "公").slice(0, 1));
    if (account.avatarUrl) {
      const image = element("img");
      image.src = account.avatarUrl;
      image.alt = "";
      avatar.replaceChildren(image);
    }
    const copy = element("div", "managed-account-copy");
    copy.append(
      element("strong", "", account.name),
      element("small", "", account.alias ? `微信号：${account.alias}` : account.seedArticleUrl ? "由文章链接添加" : "公众号平台搜索添加"),
    );
    const state = element("span", `account-state is-${account.status}`, account.status === "active" ? "监测中" : "已暂停");
    const actions = element("div", "managed-account-actions");
    if (account.status === "active") {
      actions.append(accountActionButton(account, "暂停", () => api(`/api/writing-accounts/${encodeURIComponent(account.fakeid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      })));
    } else {
      actions.append(accountActionButton(account, "恢复", () => api(`/api/writing-accounts/${encodeURIComponent(account.fakeid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      })));
    }
    actions.append(accountActionButton(account, "删除", () => api(`/api/writing-accounts/${encodeURIComponent(account.fakeid)}`, {
      method: "DELETE",
    }), "danger"));
    row.append(avatar, copy, state, actions);
    container.append(row);
  });
  setText("#writing-account-count", `${writingState.accounts.filter(item => item.status === "active").length} 个监测中`);
  renderAccountOptions();
}

async function loadWritingAccounts() {
  try {
    const result = await api("/api/writing-accounts");
    writingState.accounts = result.accounts || [];
    renderWritingAccounts();
  } catch (error) {
    setText("#writing-account-count", "读取失败");
    showToast(error.message || "公众号列表读取失败", true);
  }
}

function renderCandidates(resolvedName = "") {
  const container = $("#writing-account-candidates");
  container.replaceChildren();
  writingState.candidates.forEach(candidate => {
    const card = element("article", "account-candidate");
    const avatar = element("div", "account-candidate-avatar", (candidate.name || "公").slice(0, 1));
    if (candidate.avatarUrl) {
      const image = element("img");
      image.src = candidate.avatarUrl;
      image.alt = "";
      avatar.replaceChildren(image);
    }
    const copy = element("div", "account-candidate-copy");
    copy.append(
      element("strong", "", candidate.name),
      element("small", "", candidate.alias ? `微信号：${candidate.alias}` : "未公开微信号"),
    );
    const add = element("button", "primary-button", candidate.status === "active" ? "已添加" : "添加监测");
    add.type = "button";
    add.disabled = candidate.status === "active";
    add.addEventListener("click", async () => {
      add.disabled = true;
      try {
        await api("/api/writing-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: candidate.candidateId }),
        });
        showToast("已加入范文公众号，正在触发更新");
        writingState.candidates = [];
        renderCandidates();
        await loadWritingAccounts();
      } catch (error) {
        showToast(error.message || "添加失败", true);
        add.disabled = false;
      }
    });
    card.append(avatar, copy, add);
    container.append(card);
  });
  const status = $("#writing-account-form-status");
  status.className = writingState.candidates.length ? "is-success" : "";
  status.textContent = writingState.candidates.length
    ? `${resolvedName ? `已识别为“${resolvedName}”，` : ""}找到 ${writingState.candidates.length} 个结果，请确认。`
    : "没有找到匹配公众号，请尝试完整名称。";
}

async function loadAuthStatus() {
  try {
    const result = await api("/api/status");
    if (result.auth?.valid) {
      $("#writing-auth-panel").hidden = true;
      if (writingState.qrPollTimer) clearTimeout(writingState.qrPollTimer);
      return;
    }
    $("#writing-auth-panel").hidden = false;
    await loadQr();
  } catch {
    $("#writing-auth-panel").hidden = true;
  }
}

async function loadQr() {
  const base = writingState.runtime.authServiceUrl.replace(/\/$/, "");
  const image = $("#writing-auth-qr");
  image.onload = () => {
    image.hidden = false;
    $("#writing-qr-placeholder").hidden = true;
    setText("#writing-scan-status", "请使用微信扫码，并在手机上确认");
  };
  image.src = `${base}/api/auth/qr?v=${Date.now()}`;
  pollQr();
}

async function pollQr() {
  try {
    const result = await api("/api/auth/poll");
    setText("#writing-scan-status", result.message || "等待扫码");
    if (result.authorized) {
      $("#writing-auth-panel").hidden = true;
      showToast("授权成功，正在更新范文库");
      return;
    }
    if (result.refreshQr) {
      await loadQr();
      return;
    }
  } catch (error) {
    setText("#writing-scan-status", error.message || "二维码状态读取失败");
  }
  clearTimeout(writingState.qrPollTimer);
  writingState.qrPollTimer = setTimeout(pollQr, 2_500);
}

$("#writing-search-form").addEventListener("submit", event => {
  event.preventDefault();
  loadEntries();
});
$("#writing-query").addEventListener("input", () => {
  clearTimeout($("#writing-query").searchTimer);
  $("#writing-query").searchTimer = setTimeout(() => loadEntries(), 450);
});
$("#writing-account-filter").addEventListener("change", () => loadEntries());
$("#writing-favorites-only").addEventListener("change", () => loadEntries());
$("#writing-load-more").addEventListener("click", () => loadEntries(true));
$("#writing-account-search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#writing-account-query").value.trim();
  const status = $("#writing-account-form-status");
  writingState.candidates = [];
  renderCandidates();
  status.className = "";
  status.textContent = "正在识别并搜索…";
  try {
    const result = await api("/api/writing-accounts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(40_000),
    });
    writingState.candidates = result.candidates || [];
    renderCandidates(result.resolvedName || "");
  } catch (error) {
    status.className = "is-error";
    status.textContent = error.message || "识别失败";
  }
});

async function initWritingPage() {
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  $("#writing-local-mode").hidden = !isLocal;
  const runtime = await readJson("../data/runtime.json", null);
  writingState.runtime.authServiceUrl = runtime?.authServiceUrl
    || "https://wx-job-monitor-auth.alicebob142857-wx.workers.dev";
  await Promise.all([loadWritingStatus(), loadWritingAccounts(), loadEntries(), loadAuthStatus()]);
}

initWritingPage();
