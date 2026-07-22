const state = {
  runtime: { authServiceUrl: "" },
  status: null,
  index: { days: [] },
  history: { jobs: [] },
  pool: { jobs: [], total: 0, maxSize: 30 },
  profile: null,
  accountsConfig: { count: 0, accounts: [] },
  accountCandidates: [],
  feedback: new Map(),
  favorites: [],
  preferences: {
    customRequirement: "",
    considerFeedback: false,
    feedbackPreference: null,
    feedbackRevision: 0,
    feedbackProfileRevision: 0,
  },
  pendingFeedback: new Set(),
  feedbackRevision: 0,
  latestDate: "",
  todayJobs: [],
};

const FEEDBACK_REASON_LABELS = {
  compensation: "待遇",
  role: "岗位",
  requirements: "要求",
  location: "地区",
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
  if (!base) throw new Error("后台服务尚未配置");
  const headers = new Headers(options.headers || {});
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

function fmtPushDate(job) {
  const publishedAt = job?.article?.publishedAt;
  if (publishedAt) {
    const date = new Date(publishedAt);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(date);
    }
  }
  return job?.reportDate || "日期未明确";
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

function feedbackFor(jobId) {
  return state.feedback.get(jobId) || null;
}

function showFeedbackToast(message, isError = false) {
  let toast = $("#feedback-toast");
  if (!toast) {
    toast = node("div", "feedback-toast");
    toast.id = "feedback-toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(showFeedbackToast.timer);
  showFeedbackToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2_400);
}

function renderLearnedPreferenceStatus() {
  const preferences = state.preferences || {};
  const profile = preferences.feedbackPreference;
  text("#learned-preference-summary", profile?.summary || "尚无足够赞踩，暂不调整排序。");
  const evidence = Number(profile?.evidenceCount || 0);
  const confidence = Math.round(Number(profile?.confidence || 0) * 100);
  const pending = state.feedbackRevision > Number(preferences.feedbackProfileRevision ?? 0);
  text("#learned-preference-meta", `${evidence
    ? `基于 ${evidence} 条反馈 · 置信度 ${confidence}%`
    : "偏好只做小幅排序，不改变学历、专业和应届硬条件"}${pending ? " · 有新反馈，将在下一次更新时重新学习" : ""}`);
}

function refreshJobViews() {
  renderQualityResults();
  renderAllJobs();
  renderPool();
  renderFavorites();
  renderLearnedPreferenceStatus();
}

async function saveJobFeedback(job, sentiment, reasons = []) {
  if (!job?.id || state.pendingFeedback.has(job.id)) return;
  state.pendingFeedback.add(job.id);
  refreshJobViews();
  try {
    const result = await apiRequest(`/api/feedback/${encodeURIComponent(job.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentiment, reasons }),
    });
    state.feedback.set(job.id, result.feedback);
    state.feedbackRevision += 1;
    state.favorites = state.favorites.filter(item => item.id !== job.id);
    if (result.favorite) state.favorites.unshift(result.favorite);
    showFeedbackToast(sentiment === "like" ? "已加入收藏夹" : "已记录这次不喜欢的原因");
  } catch (error) {
    showFeedbackToast(error.message || "反馈提交失败，请稍后重试", true);
  } finally {
    state.pendingFeedback.delete(job.id);
    refreshJobViews();
  }
}

async function clearJobFeedback(job) {
  if (!job?.id || state.pendingFeedback.has(job.id)) return;
  state.pendingFeedback.add(job.id);
  refreshJobViews();
  try {
    await apiRequest(`/api/feedback/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    state.feedback.delete(job.id);
    state.feedbackRevision += 1;
    state.favorites = state.favorites.filter(item => item.id !== job.id);
    showFeedbackToast("已撤销反馈");
  } catch (error) {
    showFeedbackToast(error.message || "撤销失败，请稍后重试", true);
  } finally {
    state.pendingFeedback.delete(job.id);
    refreshJobViews();
  }
}

function renderFeedbackControls(job, compact = false) {
  const current = feedbackFor(job.id);
  const pending = state.pendingFeedback.has(job.id);
  const controls = node("div", `feedback-controls${compact ? " is-compact" : ""}`);
  controls.setAttribute("aria-label", `${job.jobTitle || "该岗位"}的赞踩反馈`);

  const like = node("button", `feedback-button like-button${current?.sentiment === "like" ? " is-active" : ""}`);
  like.type = "button";
  like.disabled = pending;
  like.setAttribute("aria-label", current?.sentiment === "like" ? "撤销赞和收藏" : "赞并加入收藏夹");
  like.setAttribute("aria-pressed", String(current?.sentiment === "like"));
  like.append(node("span", "feedback-icon", "赞"));
  like.addEventListener("click", event => {
    event.stopPropagation();
    if (current?.sentiment === "like") clearJobFeedback(job);
    else saveJobFeedback(job, "like", []);
  });

  const dislikeWrap = node("div", `dislike-wrap${current?.sentiment === "dislike" ? " has-feedback" : ""}`);
  let hoverCloseTimer;
  dislikeWrap.addEventListener("pointerenter", event => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverCloseTimer);
    dislikeWrap.classList.add("is-hover-open");
  });
  dislikeWrap.addEventListener("pointerleave", event => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = window.setTimeout(() => dislikeWrap.classList.remove("is-hover-open"), 320);
  });
  const dislike = node("button", `feedback-button dislike-button${current?.sentiment === "dislike" ? " is-active" : ""}`);
  dislike.type = "button";
  dislike.disabled = pending;
  dislike.setAttribute("aria-label", "踩；可选择不喜欢的原因");
  dislike.setAttribute("aria-pressed", String(current?.sentiment === "dislike"));
  dislike.append(node("span", "feedback-icon", "踩"));

  const panel = node("div", "dislike-panel");
  panel.append(node("strong", "", "哪里不喜欢？可多选"));
  const options = node("div", "dislike-options");
  Object.entries(FEEDBACK_REASON_LABELS).forEach(([value, label]) => {
    const option = node("label", "dislike-option");
    const input = node("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = Boolean(current?.reasons?.includes(value));
    option.append(input, node("span", "", label));
    options.append(option);
  });
  panel.append(options, node("small", "", "不选原因也可以，选好后点击“踩”提交。"));
  if (current?.sentiment === "dislike") {
    const clear = node("button", "feedback-clear", "撤销这次踩");
    clear.type = "button";
    clear.addEventListener("click", event => {
      event.stopPropagation();
      clearJobFeedback(job);
    });
    panel.append(clear);
  }
  dislike.addEventListener("click", event => {
    event.stopPropagation();
    if (window.matchMedia("(hover: none)").matches && !dislikeWrap.classList.contains("is-open")) {
      dislikeWrap.classList.add("is-open");
      return;
    }
    const reasons = [...panel.querySelectorAll("input:checked")].map(input => input.value);
    saveJobFeedback(job, "dislike", reasons);
  });
  dislikeWrap.append(dislike, panel);
  controls.append(like, dislikeWrap);
  return controls;
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
  action.append(renderFeedbackControls(job));
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
      renderFeedbackControls(job, true),
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
    const pushDate = fmtPushDate(job);
    const titleText = `${job.jobTitle || "岗位未命名"}｜${job.organization || "单位未明确"}｜${pushDate}`;
    const title = node("a", "", titleText);
    title.href = job.article?.url || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.title = titleText;
    body.append(title, node("small", "", `推送 ${pushDate} · ${compactText(job.locations)} · ${job.education?.summary || "学历未明确"} · 截止 ${job.deadline || "未披露"}`));
    const score = node("strong", "pool-score", job.personalized?.score ?? "—");
    score.title = "个性化分数";
    row.append(body, score, renderFeedbackControls(job, true));
    container.append(row);
  });
  if (!jobs.length) container.append(node("p", "pool-empty", "岗位池尚为空，下一次采集后会自动补充。"));
  text("#pool-count", `${jobs.length} / 30`);
}

function renderFavorites() {
  const jobs = [...(state.favorites || [])].sort((a, b) =>
    Date.parse(b.feedbackUpdatedAt || b.article?.publishedAt || 0)
      - Date.parse(a.feedbackUpdatedAt || a.article?.publishedAt || 0),
  );
  const container = $("#favorites-list");
  container.replaceChildren();
  jobs.forEach(job => {
    const row = node("article", "favorite-row");
    const body = node("div", "favorite-body");
    const title = node("a", "favorite-title", `${job.jobTitle || "岗位未命名"}｜${job.organization || "单位未明确"}`);
    title.href = job.article?.url || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    body.append(
      title,
      node("small", "", `${compactText(job.locations)} · ${job.education?.summary || "学历未明确"} · 截止 ${job.deadline || "未披露"}`),
    );
    row.append(body, renderFeedbackControls(job, true));
    container.append(row);
  });
  if (!jobs.length) {
    container.append(node("p", "favorites-empty", "还没有收藏岗位。看到感兴趣的岗位时点“赞”，它就会出现在这里。"));
  }
  text("#favorites-count", `${jobs.length} 个`);
}

function updateStats() {
  const stats = state.status?.stats || {};
  text("#stat-accounts", stats.accountsConfigured !== undefined ? `${stats.accountsSucceeded || 0}/${stats.accountsConfigured}` : "—");
  text("#stat-articles", stats.articlesScanned ?? "—");
}

function setAccountFormStatus(message, isError = false) {
  const status = $("#account-form-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function accountAvatar(account, className = "account-avatar") {
  const avatar = node("div", className);
  const fallback = node("span", "", (account.name || "公").slice(0, 1));
  avatar.append(fallback);
  if (account.avatarUrl) {
    const image = node("img");
    image.src = account.avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("load", () => fallback.hidden = true);
    image.addEventListener("error", () => image.remove());
    avatar.prepend(image);
  }
  return avatar;
}

function renderManagedAccounts() {
  const container = $("#managed-account-list");
  container.replaceChildren();
  const accounts = state.accountsConfig?.accounts || [];
  accounts.forEach(account => {
    const paused = account.status === "paused";
    const card = node("article", `managed-account${paused ? " is-paused" : ""}`);
    card.append(accountAvatar(account));
    const body = node("div", "managed-account-body");
    const title = node("strong", "", account.name);
    title.append(node("span", `account-status-label ${paused ? "is-paused" : "is-active"}`, paused ? "已暂停" : "监测中"));
    body.append(title, node("small", "", account.alias ? `微信号：${account.alias}` : "微信号未披露"));
    const actions = node("div", "managed-account-actions");
    const toggle = node("button", "secondary-button small-button", paused ? "恢复" : "暂停");
    toggle.type = "button";
    toggle.addEventListener("click", () => updateAccountStatus(account, paused ? "active" : "paused", toggle));
    const remove = node("button", "secondary-button small-button danger-button", "删除");
    remove.type = "button";
    remove.addEventListener("click", () => removeAccount(account, remove));
    actions.append(toggle, remove);
    card.append(body, actions);
    container.append(card);
  });
  if (!accounts.length) container.append(node("p", "account-empty", "尚未添加监测公众号。请在下方搜索并添加。"));
  const active = accounts.filter(account => account.status !== "paused").length;
  text("#managed-account-count", `${active} 个监测中${accounts.length > active ? ` · ${accounts.length - active} 个暂停` : ""}`);
}

function renderAccountCandidates() {
  const container = $("#account-search-results");
  container.replaceChildren();
  state.accountCandidates.forEach(candidate => {
    const card = node("article", "account-candidate");
    card.append(accountAvatar(candidate, "candidate-avatar"));
    const body = node("div", "candidate-body");
    body.append(node("strong", "", candidate.name), node("small", "", candidate.alias ? `微信号：${candidate.alias}` : "微信号未披露"));
    const button = node("button", "primary-button small-button", candidate.status === "active" ? "已在监测" : candidate.status === "paused" ? "恢复监测" : "添加监测");
    button.type = "button";
    button.disabled = candidate.status === "active";
    button.addEventListener("click", () => addAccountCandidate(candidate, button));
    card.append(body, button);
    container.append(card);
  });
  if (!state.accountCandidates.length) container.append(node("p", "candidate-empty", "输入公众号名称后，匹配结果会显示在这里。"));
}

async function searchAccounts(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const keyword = String(data.get("keyword") || "").trim();
  const button = form.querySelector("button");
  if (keyword.length < 2) return setAccountFormStatus("请至少输入 2 个字符。", true);
  button.disabled = true;
  setAccountFormStatus("正在微信公众平台中搜索…");
  try {
    const result = await apiRequest("/api/accounts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
      signal: AbortSignal.timeout(20_000),
    });
    state.accountCandidates = result.candidates || [];
    renderAccountCandidates();
    setAccountFormStatus(state.accountCandidates.length ? `找到 ${state.accountCandidates.length} 个候选，请确认正确账号。` : "没有找到结果，请尝试完整名称或微信号。", !state.accountCandidates.length);
  } catch (error) {
    setAccountFormStatus(error.message || "搜索失败，请稍后重试。", true);
  } finally {
    button.disabled = false;
  }
}

async function loadManagedAccounts() {
  try {
    state.accountsConfig = await apiRequest("/api/accounts");
    renderManagedAccounts();
  } catch (error) {
    setAccountFormStatus("动态列表暂时不可用，当前显示最近一次成功采集的账号。", true);
  }
}

async function addAccountCandidate(candidate, button) {
  button.disabled = true;
  button.textContent = "正在添加…";
  try {
    await apiRequest("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.candidateId }),
    });
    candidate.status = "active";
    renderAccountCandidates();
    await loadManagedAccounts();
    setAccountFormStatus(`“${candidate.name}”已加入监测，下一次采集自动生效。`);
  } catch (error) {
    setAccountFormStatus(error.message || "添加失败，请重新搜索。", true);
    button.disabled = false;
    button.textContent = "重试";
  }
}

async function updateAccountStatus(account, status, button) {
  button.disabled = true;
  try {
    await apiRequest(`/api/accounts/${encodeURIComponent(account.fakeid)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadManagedAccounts();
    setAccountFormStatus(`“${account.name}”已${status === "active" ? "恢复监测" : "暂停监测"}。`);
  } catch (error) {
    setAccountFormStatus(error.message || "状态更新失败。", true);
    button.disabled = false;
  }
}

async function removeAccount(account, button) {
  if (!window.confirm(`确认删除“${account.name}”吗？历史岗位不会被删除。`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/accounts/${encodeURIComponent(account.fakeid)}`, { method: "DELETE" });
    await loadManagedAccounts();
    setAccountFormStatus(`“${account.name}”已停止监测并从列表移除。`);
  } catch (error) {
    setAccountFormStatus(error.message || "删除失败。", true);
    button.disabled = false;
  }
}

async function loadPreferences() {
  const textarea = $("#custom-requirement");
  try {
    const preferences = await apiRequest("/api/preferences");
    state.preferences = preferences;
    textarea.value = preferences.customRequirement || "";
    $("#consider-feedback").checked = Boolean(preferences.considerFeedback);
    renderLearnedPreferenceStatus();
    text("#requirement-status", preferences.updatedAt ? `已保存 · ${fmtDateTime(preferences.updatedAt)}` : "尚未添加自定义要求");
  } catch (error) {
    text("#requirement-status", "暂时无法读取已保存要求");
    text("#learned-preference-summary", "暂时无法读取赞踩生成的偏好。");
  }
}

async function saveFeedbackPreferenceToggle(event) {
  const checkbox = event.currentTarget;
  checkbox.disabled = true;
  try {
    const result = await apiRequest("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ considerFeedback: checkbox.checked }),
    });
    state.preferences.considerFeedback = Boolean(result.considerFeedback);
    showFeedbackToast(result.considerFeedback
      ? "已启用：下一次更新会考虑赞踩偏好"
      : "已关闭：下一次更新不使用赞踩偏好");
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showFeedbackToast(error.message || "偏好开关保存失败", true);
  } finally {
    checkbox.disabled = false;
  }
}

async function loadFeedback() {
  try {
    const result = await apiRequest("/api/feedback");
    state.feedbackRevision = Number(result.revision || 0);
    state.feedback = new Map((result.feedback || []).map(item => [item.positionId, item]));
    state.favorites = result.favorites || [];
    renderLearnedPreferenceStatus();
    refreshJobViews();
  } catch (error) {
    showFeedbackToast("赞踩和收藏夹暂时无法读取", true);
    renderFavorites();
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
  renderFavorites();
  renderManagedAccounts();
  if (state.status?.state === "ok") setServiceStatus("ok", "今日任务完成");
  else if (state.status?.state === "partial") setServiceStatus("warning", "部分任务失败");
  else if (state.status?.state === "auth_required") setServiceStatus("warning", "授权已过期");
  else if (state.status?.state === "error") setServiceStatus("error", "运行失败");
  else setServiceStatus("loading", "等待首次运行");
  await Promise.all([loadPreferences(), loadFeedback(), loadManagedAccounts(), monitorRemoteAuth()]);
}

async function startApp() {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) $("#local-mode").hidden = false;
  state.runtime = await getJson("data/runtime.json", { authServiceUrl: "" });
  await initApp();
}

$("#requirement-form").addEventListener("submit", savePreferences);
$("#consider-feedback").addEventListener("change", saveFeedbackPreferenceToggle);
$("#account-search-form").addEventListener("submit", searchAccounts);
renderAccountCandidates();

startApp();
