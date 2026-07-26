const MAJOR_TOPICS = ["政治", "经济", "社会", "文化", "生态", "科技"];
const SUBTOPICS = {
  政治: ["理论作风", "改革法治", "干部担当", "党建引领"],
  经济: ["产业发展", "营商环境", "就业人才", "乡村振兴"],
  社会: ["城乡治理", "公共服务", "民生保障", "教育成长"],
  文化: ["文化传承", "文明建设", "文旅融合", "文艺传播"],
  生态: ["绿色低碳", "环境治理", "生态保护", "美丽中国"],
  科技: ["人工智能", "数字治理", "科技创新", "产业升级"],
};
const FAVORITES_KEY = "wx-writing-favorites-v1";

const state = {
  runtime: { authServiceUrl: "" },
  allEntries: [],
  filteredEntries: [],
  accounts: [],
  candidates: [],
  selectedMajor: "",
  selectedSubtopics: new Set(),
  localFavorites: new Set(),
  visibleCount: 30,
  serviceReachable: false,
  staticGeneratedAt: null,
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
  const base = state.runtime.authServiceUrl.replace(/\/$/, "");
  if (!base) throw new Error("后台服务尚未配置");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: new Headers(options.headers || {}),
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(7_000),
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
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2_600);
}

function loadLocalFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    state.localFavorites = new Set(Array.isArray(values) ? values.map(String) : []);
  } catch {
    state.localFavorites = new Set();
  }
}

function saveLocalFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.localFavorites]));
}

function normalizeEntry(entry) {
  const majorTopic = MAJOR_TOPICS.includes(entry.majorTopic) ? entry.majorTopic : "社会";
  const allowedSubtopics = SUBTOPICS[majorTopic] || [];
  return {
    ...entry,
    majorTopic,
    subtopic: allowedSubtopics.includes(entry.subtopic) ? entry.subtopic : allowedSubtopics[0],
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    commentarySections: Array.isArray(entry.commentarySections) ? entry.commentarySections : [],
    favorite: Boolean(entry.favorite),
    expanded: location.hash === `#writing-${entry.id}`,
  };
}

function isFavorite(entry) {
  return Boolean(entry.favorite || state.localFavorites.has(entry.id));
}

function updateFavoriteMetrics() {
  const favorites = state.allEntries.filter(isFavorite).length;
  setText("#writing-favorite-total", favorites);
}

function setDataMode(live) {
  state.serviceReachable = live;
  const banner = $("#writing-data-mode");
  if (live) {
    banner.hidden = true;
    setServiceStatus("ok", "实时数据已连接");
  } else {
    banner.hidden = false;
    banner.innerHTML = "<strong>国内直连模式</strong><span>正在读取每日静态快照；阅读、检索和本机收藏不依赖 Cloudflare 接口。</span>";
    setServiceStatus("ok", "静态数据可用");
  }
  renderWritingAccounts();
}

function appendParagraphs(container, text) {
  const paragraphs = String(text || "").split(/\n+/).map(item => item.trim()).filter(Boolean);
  if (!paragraphs.length) {
    container.append(element("p", "", "原文未提取到可展示内容。"));
    return;
  }
  paragraphs.forEach(paragraph => container.append(element("p", "", paragraph)));
}

function buildEntryDetail(entry) {
  const detail = element("section", "writing-entry-detail");
  const meta = element("div", "writing-detail-meta");
  meta.append(
    element("span", "", entry.account || "公众号"),
    element("span", "", formatDate(entry.publishedAt)),
    element("span", "", `${Number(entry.wordCount || 0).toLocaleString("zh-CN")} 字`),
  );
  const original = element("a", "writing-original-link", "查看公众号原文");
  original.href = entry.articleUrl;
  original.target = "_blank";
  original.rel = "noopener noreferrer";
  meta.append(original);
  detail.append(meta);
  if (entry.summary) detail.append(element("p", "writing-detail-summary", entry.summary));

  const grid = element("div", "writing-content-grid");
  const essayPane = element("section", "writing-pane essay-pane");
  const essayHeading = element("div", "writing-pane-heading");
  essayHeading.append(element("strong", "", "范文原文"), element("span", "", "完整正文"));
  const essayText = element("div", "writing-prose");
  appendParagraphs(essayText, entry.essayText);
  essayPane.append(essayHeading, essayText);

  const commentaryPane = element("section", "writing-pane commentary-pane");
  const commentaryHeading = element("div", "writing-pane-heading");
  commentaryHeading.append(
    element("strong", "", "老师点评"),
    element("span", "", `${entry.commentarySections.length} 处解析`),
  );
  const commentaryList = element("div", "writing-prose");
  entry.commentarySections.forEach((section, index) => {
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
  detail.append(grid);
  if (entry.sourceNote) detail.append(element("p", "writing-source-note", `来源说明：${entry.sourceNote}`));
  return detail;
}

async function toggleFavorite(entry, button) {
  const next = !isFavorite(entry);
  entry.favorite = next;
  if (next) state.localFavorites.add(entry.id);
  else state.localFavorites.delete(entry.id);
  saveLocalFavorites();
  button.classList.toggle("is-active", next);
  button.textContent = next ? "★" : "☆";
  button.setAttribute("aria-label", next ? "取消收藏" : "收藏");
  button.setAttribute("aria-pressed", String(next));
  updateFavoriteMetrics();
  if ($("#writing-favorites-only").checked && !next) applyFilters(false);

  if (!state.serviceReachable) {
    showToast(next ? "已收藏到当前浏览器" : "已取消本机收藏");
    return;
  }
  try {
    await api(`/api/writing-favorites/${encodeURIComponent(entry.id)}`, {
      method: next ? "PUT" : "DELETE",
    });
    showToast(next ? "已收藏并同步" : "已取消收藏");
  } catch {
    setDataMode(false);
    showToast("已保存在当前浏览器，稍后联网可继续使用");
  }
}

function renderEntry(entry) {
  const article = element("article", `writing-list-item${entry.expanded ? " is-open" : ""}`);
  article.id = `writing-${entry.id}`;
  const row = element("div", "writing-title-row");
  const open = element("button", "writing-title-button");
  open.type = "button";
  open.setAttribute("aria-expanded", String(Boolean(entry.expanded)));
  open.append(
    element("h3", "", entry.essayTitle || entry.articleTitle),
    element("span", "writing-open-hint", entry.expanded ? "收起全文" : "阅读全文"),
  );
  const favorite = element("button", `writing-favorite-icon${isFavorite(entry) ? " is-active" : ""}`, isFavorite(entry) ? "★" : "☆");
  favorite.type = "button";
  favorite.setAttribute("aria-label", isFavorite(entry) ? "取消收藏" : "收藏");
  favorite.setAttribute("aria-pressed", String(isFavorite(entry)));
  favorite.addEventListener("click", () => toggleFavorite(entry, favorite));
  row.append(open, favorite);
  article.append(row);

  let detail = null;
  const setExpanded = expanded => {
    entry.expanded = expanded;
    article.classList.toggle("is-open", expanded);
    open.setAttribute("aria-expanded", String(expanded));
    open.lastElementChild.textContent = expanded ? "收起全文" : "阅读全文";
    if (expanded && !detail) {
      detail = buildEntryDetail(entry);
      article.append(detail);
    }
    if (detail) detail.hidden = !expanded;
    if (expanded) history.replaceState(null, "", `#writing-${entry.id}`);
    else if (location.hash === `#writing-${entry.id}`) history.replaceState(null, "", location.pathname + location.search);
  };
  open.addEventListener("click", () => setExpanded(!entry.expanded));
  if (entry.expanded) setExpanded(true);
  return article;
}

function renderEntries() {
  const container = $("#writing-results");
  const visible = state.filteredEntries.slice(0, state.visibleCount);
  container.replaceChildren(...visible.map(renderEntry));
  $("#writing-empty").hidden = state.filteredEntries.length > 0;
  $("#writing-load-more").hidden = visible.length >= state.filteredEntries.length;
  setText("#writing-result-count", `${state.filteredEntries.length} 篇`);
  const query = $("#writing-query").value.trim();
  setText("#writing-result-title", query ? `“${query}”的检索结果` : $("#writing-favorites-only").checked ? "我的收藏" : "范文目录");
}

function renderMajorFilters() {
  const container = $("#writing-major-filters");
  container.replaceChildren();
  [["", "全部"], ...MAJOR_TOPICS.map(topic => [topic, topic])].forEach(([value, label]) => {
    const button = element("button", `topic-filter-button${state.selectedMajor === value ? " is-active" : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.selectedMajor === value));
    button.addEventListener("click", () => {
      state.selectedMajor = value;
      const available = new Set(availableSubtopics());
      state.selectedSubtopics = new Set([...state.selectedSubtopics].filter(item => available.has(item)));
      renderMajorFilters();
      renderSubtopicFilters();
      applyFilters();
    });
    container.append(button);
  });
}

function availableSubtopics() {
  const entries = state.selectedMajor
    ? state.allEntries.filter(entry => entry.majorTopic === state.selectedMajor)
    : state.allEntries;
  const present = new Set(entries.map(entry => entry.subtopic).filter(Boolean));
  const ordered = state.selectedMajor
    ? SUBTOPICS[state.selectedMajor]
    : MAJOR_TOPICS.flatMap(topic => SUBTOPICS[topic]);
  return ordered.filter(item => present.has(item));
}

function renderSubtopicFilters() {
  const container = $("#writing-subtopic-filters");
  const topics = availableSubtopics();
  container.replaceChildren();
  const all = element("button", `subtopic-filter-button${state.selectedSubtopics.size === 0 ? " is-active" : ""}`, "全部细分方向");
  all.type = "button";
  all.addEventListener("click", () => {
    state.selectedSubtopics.clear();
    renderSubtopicFilters();
    applyFilters();
  });
  container.append(all);
  topics.forEach(topic => {
    const selected = state.selectedSubtopics.has(topic);
    const button = element("button", `subtopic-filter-button${selected ? " is-active" : ""}`, topic);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.addEventListener("click", () => {
      if (selected) state.selectedSubtopics.delete(topic);
      else state.selectedSubtopics.add(topic);
      renderSubtopicFilters();
      applyFilters();
    });
    container.append(button);
  });
  setText("#writing-subtopic-count", state.selectedSubtopics.size ? `已选 ${state.selectedSubtopics.size} 项` : "可多选");
}

function applyFilters(resetVisible = true) {
  const query = $("#writing-query").value.trim().toLocaleLowerCase();
  const account = $("#writing-account-filter").value;
  const favoritesOnly = $("#writing-favorites-only").checked;
  state.filteredEntries = state.allEntries.filter(entry => {
    if (state.selectedMajor && entry.majorTopic !== state.selectedMajor) return false;
    if (state.selectedSubtopics.size && !state.selectedSubtopics.has(entry.subtopic)) return false;
    if (account && entry.accountFakeid !== account) return false;
    if (favoritesOnly && !isFavorite(entry)) return false;
    if (!query) return true;
    return [
      entry.essayTitle,
      entry.articleTitle,
      entry.theme,
      entry.majorTopic,
      entry.subtopic,
      ...(entry.keywords || []),
      entry.summary,
      entry.essayText,
      entry.commentaryText,
    ].filter(Boolean).join("\n").toLocaleLowerCase().includes(query);
  }).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  if (resetVisible) state.visibleCount = 30;
  renderEntries();
  updateFavoriteMetrics();
}

function setEntries(entries, generatedAt = null) {
  const expandedIds = new Set(state.allEntries.filter(entry => entry.expanded).map(entry => entry.id));
  state.allEntries = (entries || []).map(normalizeEntry);
  state.allEntries.forEach(entry => {
    if (expandedIds.has(entry.id)) entry.expanded = true;
  });
  state.staticGeneratedAt = generatedAt || state.staticGeneratedAt;
  setText("#writing-total", state.allEntries.length);
  const latest = state.allEntries.map(entry => entry.publishedAt).filter(Boolean).sort().at(-1);
  setText("#writing-last-date", latest ? formatDate(latest).slice(5) : "—");
  setText("#writing-last-run", state.staticGeneratedAt ? `${formatDate(state.staticGeneratedAt, true)} 快照` : "等待更新");
  renderMajorFilters();
  renderSubtopicFilters();
  applyFilters();
}

function renderAccountOptions() {
  const select = $("#writing-account-filter");
  const current = select.value;
  select.replaceChildren(element("option", "", "全部公众号"));
  select.firstElementChild.value = "";
  state.accounts.filter(item => item.status === "active").forEach(account => {
    const option = element("option", "", account.name);
    option.value = account.fakeid;
    select.append(option);
  });
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function accountActionButton(label, action, extraClass = "") {
  const button = element("button", `account-action ${extraClass}`.trim(), label);
  button.type = "button";
  button.disabled = !state.serviceReachable;
  button.title = state.serviceReachable ? "" : "当前网络无法连接公众号管理服务";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
      await refreshLiveAccounts();
    } catch (error) {
      showToast(error.message || "公众号操作失败", true);
      button.disabled = false;
    }
  });
  return button;
}

function renderWritingAccounts() {
  const container = $("#writing-account-list");
  if (!container) return;
  container.replaceChildren();
  state.accounts.forEach(account => {
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
    const accountState = element("span", `account-state is-${account.status}`, account.status === "active" ? "监测中" : "已暂停");
    const actions = element("div", "managed-account-actions");
    const nextStatus = account.status === "active" ? "paused" : "active";
    actions.append(accountActionButton(account.status === "active" ? "暂停" : "恢复", () => api(
      `/api/writing-accounts/${encodeURIComponent(account.fakeid)}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) },
    )));
    actions.append(accountActionButton("删除", () => api(
      `/api/writing-accounts/${encodeURIComponent(account.fakeid)}`,
      { method: "DELETE" },
    ), "danger"));
    row.append(avatar, copy, accountState, actions);
    container.append(row);
  });
  setText("#writing-account-count", `${state.accounts.filter(item => item.status === "active").length} 个监测中`);
  renderAccountOptions();
}

async function refreshLiveAccounts() {
  const result = await api("/api/writing-accounts");
  state.accounts = result.accounts || [];
  renderWritingAccounts();
}

function renderCandidates(resolvedName = "") {
  const container = $("#writing-account-candidates");
  container.replaceChildren();
  state.candidates.forEach(candidate => {
    const card = element("article", "account-candidate");
    const avatar = element("div", "account-candidate-avatar", (candidate.name || "公").slice(0, 1));
    const copy = element("div", "account-candidate-copy");
    copy.append(element("strong", "", candidate.name), element("small", "", candidate.alias ? `微信号：${candidate.alias}` : "未公开微信号"));
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
        showToast("已加入范文公众号");
        state.candidates = [];
        renderCandidates();
        await refreshLiveAccounts();
      } catch (error) {
        showToast(error.message || "添加失败", true);
        add.disabled = false;
      }
    });
    card.append(avatar, copy, add);
    container.append(card);
  });
  const status = $("#writing-account-form-status");
  status.className = state.candidates.length ? "is-success" : "";
  status.textContent = state.candidates.length
    ? `${resolvedName ? `已识别为“${resolvedName}”，` : ""}找到 ${state.candidates.length} 个结果，请确认。`
    : "没有找到匹配公众号，请尝试完整名称。";
}

async function refreshLiveEntries() {
  const result = await api("/api/writing-entries?limit=1000&offset=0");
  if (Array.isArray(result.entries)) setEntries(result.entries);
}

async function refreshLiveStatus() {
  const result = await api("/api/writing-status");
  setText("#writing-total", Number(result.total || state.allEntries.length));
  setText("#writing-last-date", result.date ? result.date.slice(5).replace("-", "/") : "—");
  setText("#writing-last-run", result.lastRunAt ? `${formatDate(result.lastRunAt, true)} 更新` : "尚未运行");
}

async function loadAuthStatus() {
  try {
    const result = await api("/api/status");
    if (result.auth?.valid) {
      $("#writing-auth-panel").hidden = true;
      if (state.qrPollTimer) clearTimeout(state.qrPollTimer);
      return;
    }
    $("#writing-auth-panel").hidden = false;
    await loadQr();
  } catch {
    $("#writing-auth-panel").hidden = true;
  }
}

async function loadQr() {
  const base = state.runtime.authServiceUrl.replace(/\/$/, "");
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
  } catch {
    setDataMode(false);
    $("#writing-auth-panel").hidden = true;
    return;
  }
  clearTimeout(state.qrPollTimer);
  state.qrPollTimer = setTimeout(pollQr, 2_500);
}

async function probeLiveService() {
  try {
    await api("/health");
    setDataMode(true);
    await Promise.allSettled([
      refreshLiveEntries(),
      refreshLiveStatus(),
      refreshLiveAccounts(),
      loadAuthStatus(),
    ]);
  } catch {
    setDataMode(false);
  }
}

$("#writing-search-form").addEventListener("submit", event => {
  event.preventDefault();
  applyFilters();
});
$("#writing-query").addEventListener("input", () => {
  clearTimeout($("#writing-query").searchTimer);
  $("#writing-query").searchTimer = setTimeout(() => applyFilters(), 250);
});
$("#writing-account-filter").addEventListener("change", () => applyFilters());
$("#writing-favorites-only").addEventListener("change", () => applyFilters());
$("#writing-load-more").addEventListener("click", () => {
  state.visibleCount += 30;
  renderEntries();
});
$("#writing-account-search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const status = $("#writing-account-form-status");
  if (!state.serviceReachable) {
    status.className = "is-error";
    status.textContent = "当前网络无法连接公众号管理服务；阅读和搜索仍可正常使用。";
    return;
  }
  const query = $("#writing-account-query").value.trim();
  state.candidates = [];
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
    state.candidates = result.candidates || [];
    renderCandidates(result.resolvedName || "");
  } catch (error) {
    status.className = "is-error";
    status.textContent = error.message || "识别失败";
  }
});

async function initWritingPage() {
  loadLocalFavorites();
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  $("#writing-local-mode").hidden = !isLocal;
  const [runtime, snapshot, accountsSnapshot, statusSnapshot] = await Promise.all([
    readJson("../data/runtime.json", null),
    readJson("data/entries.json", { entries: [], generatedAt: null }),
    readJson("data/accounts.json", { accounts: [] }),
    readJson("data/status.json", { lastRunAt: null }),
  ]);
  state.runtime.authServiceUrl = runtime?.authServiceUrl
    || "https://wx-job-monitor-auth.alicebob142857-wx.workers.dev";
  state.accounts = accountsSnapshot?.accounts || [];
  renderWritingAccounts();
  setEntries(snapshot?.entries || [], snapshot?.generatedAt || statusSnapshot?.lastRunAt);
  setDataMode(false);
  probeLiveService();
}

initWritingPage();
