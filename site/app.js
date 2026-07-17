const state = { index: null, report: null, status: null, runtime: null, account: "", level: "", query: "" };

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
  text("#stat-relevant", stats?.positionsExtracted ?? stats?.relevantArticles ?? "—");
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined && content !== null) element.textContent = String(content);
  return element;
}

function chip(label, extra = "") {
  return node("span", `chip ${extra}`.trim(), label);
}

function fitLabel(value) {
  return ({
    administrative_management: "行政管理优先",
    management: "管理类匹配",
    humanities: "文科匹配",
    broad: "专业不限",
    uncertain: "专业待核对",
    mismatch: "专业低匹配",
  })[value] || "专业待核对";
}

function educationLabel(value) {
  return ({ master: "硕士优先", bachelor_associate: "本科 / 大专", unspecified: "学历待核对", phd_required: "硬性博士" })[value] || "学历待核对";
}

function levelLabel(value) {
  return ({ high: "优先推荐", medium: "可以考虑", low: "谨慎考虑" })[value] || "待评估";
}

function appendList(container, values, emptyText = "原文未披露") {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) {
    container.append(node("p", "detail-empty", emptyText));
    return;
  }
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

function flattenStaticReport(report) {
  const jobs = [];
  for (const item of report?.items || []) {
    if (Array.isArray(item.positions)) {
      for (const position of item.positions) {
        jobs.push({
          ...position,
          account: item.account,
          article: {
            title: item.title, url: item.url, publishedAt: item.publishedAt, summary: item.summary,
            ocrUsed: item.ocrUsed, ocrImageCount: item.ocrImageCount,
            analysisSource: item.analysisSource, extractionComplete: item.extractionComplete,
          },
        });
      }
    } else {
      jobs.push({
        id: item.id,
        account: item.account,
        organization: item.account,
        jobTitle: item.title,
        locations: item.locations || [],
        employmentTypes: item.jobTypes || [],
        education: { summary: "旧版报告未提取", tier: "unspecified", hardPhdRequired: false },
        majors: { summary: (item.suitableMajors || []).join("、") || "旧版报告未提取", accepted: item.suitableMajors || [], fit: "uncertain" },
        applicationRequirements: [],
        compensation: { summary: "旧版报告未提取", salary: null, benefits: [], quality: 0 },
        recommendation: { score: Math.round((item.confidence || 0) * 100), rankingKey: 0, level: "low", reasons: item.reasons || [], concerns: ["等待 DeepSeek 岗位级重分析"] },
        article: { title: item.title, url: item.url, publishedAt: item.publishedAt, summary: item.summary, ocrUsed: item.ocrUsed, ocrImageCount: item.ocrImageCount, analysisSource: item.source || "heuristic", extractionComplete: false },
      });
    }
  }
  return jobs.sort((a, b) => (b.recommendation?.rankingKey || 0) - (a.recommendation?.rankingKey || 0));
}

function renderResults() {
  const container = $("#results");
  container.replaceChildren();
  const jobs = state.report?.jobs || [];
  const query = state.query.toLowerCase();
  const filtered = jobs.filter(job => {
    if (state.account && job.account !== state.account) return false;
    if (state.level && job.recommendation?.level !== state.level) return false;
    if (!query) return true;
    return [
      job.jobTitle, job.organization, job.account, job.education?.summary, job.majors?.summary,
      job.compensation?.summary, ...(job.locations || []), ...(job.applicationRequirements || []),
    ].join(" ").toLowerCase().includes(query);
  });

  for (const job of filtered) {
    const card = node("article", `job-card level-${job.recommendation?.level || "low"}`);
    const source = node("div", "job-source-column");
    source.append(node("span", "job-source", job.account), node("span", "job-date", fmtDateTime(job.article?.publishedAt)));

    const body = node("div", "job-body");
    const headingRow = node("div", "job-heading-row");
    const heading = node("div", "job-heading");
    heading.append(node("h3", "", job.jobTitle), node("p", "job-organization", job.organization || "单位未明确"));
    const score = node("div", `score-badge is-${job.recommendation?.level || "low"}`);
    score.append(node("strong", "", job.recommendation?.score ?? "—"), node("span", "", levelLabel(job.recommendation?.level)));
    headingRow.append(heading, score);

    const chips = node("div", "chips");
    chips.append(chip(fitLabel(job.majors?.fit), `fit-${job.majors?.fit || "uncertain"}`));
    chips.append(chip(educationLabel(job.education?.tier), job.education?.hardPhdRequired ? "phd" : ""));
    (job.locations || []).slice(0, 3).forEach(value => chips.append(chip(value)));
    if (job.compensation?.salary) chips.append(chip(job.compensation.salary, "salary"));
    if (job.article?.ocrUsed) chips.append(chip(`OCR ${job.article.ocrImageCount} 图`, "ocr"));

    const verdicts = node("div", "verdicts");
    const pros = node("section", "verdict verdict-pro");
    pros.append(node("h4", "", "推荐理由"));
    appendList(pros, job.recommendation?.reasons, "暂无明确推荐依据");
    const concerns = node("section", "verdict verdict-con");
    concerns.append(node("h4", "", "不推荐 / 风险"));
    appendList(concerns, job.recommendation?.concerns, "暂无明显风险");
    verdicts.append(pros, concerns);

    const details = node("details", "job-details");
    details.append(node("summary", "", "查看完整岗位要求"));
    const grid = node("div", "detail-grid");
    grid.append(
      detailBlock("学历要求", job.education?.summary, [
        job.education?.minimum ? `最低：${job.education.minimum}` : "",
        job.education?.preferred ? `优先：${job.education.preferred}` : "",
      ]),
      detailBlock("专业要求", job.majors?.summary, job.majors?.accepted || []),
      detailBlock("报考要求", null, job.applicationRequirements || []),
      detailBlock("薪资与福利", job.compensation?.summary, [
        job.compensation?.salary ? `薪资：${job.compensation.salary}` : "",
        ...(job.compensation?.benefits || []),
      ]),
      detailBlock("报名信息", null, [
        job.headcount ? `人数：${job.headcount}` : "",
        ...(job.employmentTypes || []),
        job.deadline ? `截止：${job.deadline}` : "",
        job.applicationMethod ? `方式：${job.applicationMethod}` : "",
      ]),
    );
    details.append(grid);

    body.append(headingRow, chips, verdicts, details);
    const action = node("div", "job-action");
    const link = node("a", "job-link", "查看原文 ↗");
    link.href = job.article?.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    action.append(link, node("span", "confidence", `AI 置信度 ${Math.round((job.confidence || 0) * 100)}%`));
    card.append(source, body, action);
    container.append(card);
  }
  text("#result-count", `${filtered.length} 个岗位`);
  $("#empty-state").hidden = filtered.length !== 0;
}

function populateAccounts() {
  const select = $("#account-select");
  while (select.options.length > 1) select.remove(1);
  const accounts = [...new Set((state.report?.jobs || []).map(job => job.account).filter(Boolean))].sort();
  for (const account of accounts) {
    const option = node("option", "", account);
    option.value = account;
    select.append(option);
  }
}

async function loadReport(date) {
  const base = state.runtime?.authServiceUrl?.replace(/\/$/, "");
  let report = null;
  if (date && base) report = await getJson(`${base}/api/jobs?date=${encodeURIComponent(date)}&limit=1000`);
  if ((!report || !report.jobs?.length) && date) {
    const fallback = await getJson(`data/daily/${date}.json`, { date, items: [], stats: state.status?.stats || null });
    const fallbackJobs = flattenStaticReport(fallback);
    if (!report || fallbackJobs.length) {
      report = { date, generatedAt: fallback.generatedAt, stats: fallback.stats, jobs: fallbackJobs };
    }
  }
  state.report = report || { date, jobs: [], stats: state.status?.stats || null };
  text("#current-date", fmtDate(date));
  text("#last-run", state.report?.generatedAt ? `完成于 ${fmtDateTime(state.report.generatedAt)}` : "等待首次采集");
  updateStats(state.report?.stats || state.status?.stats);
  populateAccounts();
  renderResults();
}

async function setupDates() {
  const select = $("#date-select");
  select.replaceChildren();
  const base = state.runtime?.authServiceUrl?.replace(/\/$/, "");
  const remoteDays = base ? await getJson(`${base}/api/job-days`) : null;
  const days = remoteDays?.days?.some(day => Number(day.positionCount) > 0) ? remoteDays.days : state.index?.days || [];
  if (!days.length) {
    const option = node("option", "", "暂无报告");
    option.value = "";
    select.append(option);
    await loadReport("");
    return;
  }
  for (const day of days) {
    const option = node("option", "", `${day.date} · ${day.positionCount ?? day.relevantCount ?? 0} 岗位`);
    option.value = day.date;
    select.append(option);
  }
  await loadReport(days[0].date);
}

function showAuthPanel(message) {
  $("#auth-panel").hidden = false;
  if (message) text("#auth-message", message);
}

function hideAuthPanel() { $("#auth-panel").hidden = true; }

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
  if (remote.auth?.valid) { hideAuthPanel(); setServiceStatus("ok", "授权正常"); return; }
  showAuthPanel();
  setServiceStatus("warning", "等待扫码授权");
  const qr = $("#auth-qr");
  qr.src = `${base}/api/auth/qr?v=${Date.now()}`;
  qr.hidden = false;
  $("#qr-placeholder").hidden = true;
  const poll = async () => {
    const result = await getJson(`${base}/api/auth/poll`);
    if (!result) { text("#scan-status", "暂时无法查询扫码状态"); return setTimeout(poll, 4000); }
    text("#scan-status", result.message || "等待扫码");
    if (result.authorized) {
      setServiceStatus("ok", "授权已恢复");
      text("#auth-message", "授权成功。下一次定时任务将恢复采集。");
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
$("#level-select").addEventListener("change", event => { state.level = event.target.value; renderResults(); });
$("#search-input").addEventListener("input", event => { state.query = event.target.value.trim(); renderResults(); });

init();
