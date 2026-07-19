# 文管求职雷达

每天读取 10 个微信公众号的最新推送，从网页正文和图片 OCR 中逐岗位提取招聘信息，再使用 DeepSeek 分析单位性质、行业、招聘类型、岗位方向、学历、专业、报考条件、网申信息、薪资福利和推荐依据。岗位写入 Cloudflare D1，并发布到 GitHub Pages；微信扫码登录会话由 Cloudflare Worker + KV 保存，不依赖个人电脑常驻。

## 个性化推荐规则

默认求职画像保存在 [`config/profile.json`](config/profile.json)：北京师范大学、行政管理专业、硕士研究生、具有应届毕业生身份。优质岗位不是单纯采用模型自由打分，而是先通过固定硬条件：

1. 明确面向应届毕业生或校园招聘，不接受纯社招、实习和见习。
2. 学历门槛为本科或硕士，不包含大专/专科，也不能硬性只招博士。
3. 专业明确覆盖行政管理、公共管理类、管理学门类，或明确不限专业。仅招其他管理专业但不含行政管理的岗位不会误入优质区。
4. 通过硬条件后，再按专业精确度、硕士匹配、单位性质、薪资福利、报名可操作性和自定义要求排序。

网页按“今日优质岗位 → 折叠的今日全部岗位 → 最优质岗位池”展示。岗位池每天加入新优质岗位、去除明确过期和排名靠后的岗位，最多保留 30 个。DeepSeek 负责拆分岗位、提取字段、自定义要求判断及生成推荐/不推荐理由；程序硬筛选保证底线稳定。

网页“自定义重要要求”会写入 D1，并在下一次采集时自动附加到 DeepSeek 提示词。它可以影响优质资格和排序，但不能放宽应届、学历和专业三项硬条件。

## 历史总表

- 网页优先读取 GitHub Pages 随任务生成的静态汇总，不依赖浏览器能否直连岗位数据库；D1 仍保存同一份结构化记录。
- “下载 CSV”直接下载 Pages 上的 UTF-8 CSV，可用 Excel、WPS 或腾讯文档打开。
- 总表包含公众号、更新日期、企业性质、单位、招聘类型、行业、推文标题、岗位、岗位方向、专业、地点、原文、网申、截止日期、往届生资格、学历、届别、内推码、报考要求、薪资福利及推荐结论。
- 公开只读接口为 `/api/job-history` 和 `/api/jobs.csv`；D1 写入仍必须携带服务端令牌。

## 公众号管理

公众号列表保存在 Cloudflare D1。网页底部“公众号管理”可以按名称或微信号搜索微信公众平台，确认候选后直接添加，也可以暂停、恢复或删除监测；无需手工查找 `fakeid`，也无需修改 GitHub 文件。定时任务每次运行时通过带服务令牌的接口读取 D1 中的启用账号。

[`config/accounts.json`](config/accounts.json) 只保留最初 10 个账号作为迁移种子和故障兜底。Worker 首次运行会幂等写入 D1；正常情况下 D1 是权威配置源。

当前 10 个公众号：

| 公众号 | 微信号 / alias | fakeid |
|---|---|---|
| 央企求职网 | `yangqiqiuzhi` | `MzIzMzcyNjU1MQ==` |
| 五财一贸 | `wucaiyimao` | `MzAwMDY2Mjc1Mw==` |
| 国企求职网 | `guoqizhaopinwang` | `MzIxMTU3OTA5Nw==` |
| 晓央就业 | `cufe-coco` | `MzkyNTIwMDA1OQ==` |
| 北大就业 | `pku_scc` | `MzA4NjAzMTIxNw==` |
| 国资小新 | `guozixiaoxin` | `MjM5MDIxNjczNA==` |
| 国聘 | `iguopincom` | `MzU4MzQ2NzUxMw==` |
| 人大就业创业 | `RUCcareercenter` | `MjM5MTE5MTY4Mw==` |
| 清华就业 | `THUCareer` | `MzUyMjc4NjA4Nw==` |
| 北航就业 | 未填写 | `MjM5MzI0Nzc2Ng==` |

添加新公众号：

1. 在网站底部输入公众号完整名称或微信号。
2. 根据名称、头像和微信号选择正确候选，点击“添加监测”。
3. 账号立即写入 D1；等待次日 10:00，或手动运行 [Daily WeChat job scan](https://github.com/alicebob142857/wx_tool/actions/workflows/daily.yml)。

搜索接口依赖有效的微信公众平台授权。如果授权过期，先在网站扫码恢复；若目标公众号关闭了名称搜索，可以尝试微信号或更完整的名称。

## 已验证范围

- 10/10 目标公众号可以通过固定 `fakeid` 获取文章列表。
- 10/10 用户提供的已知文章链接出现在对应公众号的最新推送中。
- 图片型招聘公告可以获取图片清单并用 `chi_sim+eng` OCR。
- `accountbyurl` 反查不作为生产依赖。

## 架构

```text
GitHub Actions (每天 02:00 UTC / 北京时间 10:00)
  ├─ Cloudflare Worker：检查登录、获取公众号文章列表
  ├─ 微信文章页：抓正文与图片
  ├─ Tesseract：中文 OCR
  ├─ DeepSeek：逐岗位结构化提取与推荐分析
  ├─ Cloudflare D1：持久化文章、岗位和每日统计
  └─ GitHub Pages：发布日报与授权二维码

Cloudflare Worker
  ├─ KV：保存最多 4 天的微信会话和 180 天的网站浏览器会话
  ├─ D1：岗位数据库、个性化结果与自定义要求（Worker 首次运行时幂等初始化新表）
  ├─ D1：监测公众号列表、启用/暂停/删除状态
  ├─ searchbiz：按名称或微信号搜索公众号并自动保存 fakeid
  ├─ QR：创建、展示、轮询扫码状态
  └─ repository_dispatch：授权成功后重新触发 GitHub Actions（可选）
```

## 本地运行

要求 Node.js 22+ 和 Tesseract，且安装 `chi_sim`、`eng` 语言包。

```bash
cp .env.example .env
npm install
npm test
npm run check
npm run collect
npm run site:serve
```

本地首次验证可以使用 `WX_EXPORTER_AUTH_KEY`。生产环境推荐配置 `AUTH_SERVICE_URL` 和 `AUTH_SERVICE_TOKEN`，不再手动复制四天有效的 Key。

## Cloudflare Worker 初始化

1. 登录 Cloudflare：

   ```bash
   npx wrangler login
   ```

2. 创建 KV 和 D1：

   ```bash
   npx wrangler kv namespace create AUTH_KV
   npx wrangler d1 create wx-job-monitor-db
   ```

3. 把命令返回的 KV 与 D1 ID 写入 `worker/wrangler.jsonc`，然后执行：

   ```bash
   npm run db:migrate
   ```

4. 设置一个随机的服务端令牌：

   ```bash
   npx wrangler secret put COLLECTOR_TOKEN --config worker/wrangler.jsonc
   ```

   网站密码以 SHA-256 哈希形式保存在 `worker/wrangler.jsonc` 的 `SITE_PASSWORD_HASH` 中，不保存明文。修改密码时重新计算哈希并替换该变量。

5. 可选：为了扫码成功后立即重跑 GitHub Action，设置：

   ```bash
   npx wrangler secret put GITHUB_DISPATCH_TOKEN --config worker/wrangler.jsonc
   ```

   并把 `worker/wrangler.jsonc` 中 `GITHUB_REPOSITORY` 改为 `用户名/仓库名`。令牌只需授予目标仓库触发 dispatch 所需的最小权限。

6. 部署：

   ```bash
   npm run worker:deploy
   ```

## GitHub 配置

在仓库 `Settings → Secrets and variables → Actions` 添加：

| Secret | 用途 |
|---|---|
| `AUTH_SERVICE_URL` | Cloudflare Worker 地址，例如 `https://wx-job-monitor-auth.example.workers.dev` |
| `AUTH_SERVICE_TOKEN` | 与 Worker 的 `COLLECTOR_TOKEN` 完全相同 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `CLOUDFLARE_API_TOKEN` | 仅用于 GitHub 中手动部署 Worker |
| `CLOUDFLARE_ACCOUNT_ID` | 仅用于 GitHub 中手动部署 Worker |

然后在 `Settings → Pages` 中将 Source 选择为 **GitHub Actions**，手动运行一次 `Daily WeChat job scan`。

如需用 DeepSeek 重新分析最近 36 小时，在 Actions 手动运行工作流时把 `reprocess_hours` 填为 `36`。定时任务保持 `0`，只处理增量文章。

## 授权过期

当 Worker 判断微信登录失效：

1. 日报状态改为 `auth_required`。
2. GitHub Pages 显示扫码区域。
3. 网页调用 Worker 获取二维码并轮询扫码状态。
4. 用户扫码并在微信中选择订阅号或服务号。
5. Worker 将新 Cookie 和 token 写入 KV；不会把它们返回网页或提交 GitHub。
6. 如果配置了 `GITHUB_DISPATCH_TOKEN`，Worker 自动触发一次采集；否则可以在 Actions 页面手动运行。

## 安全

- `.env` 已加入 `.gitignore`，不得提交。
- DeepSeek Key 只放 GitHub Secrets。
- 微信 Cookie 只放 Cloudflare KV。
- D1 报告写接口需要服务端 Bearer Token；自定义要求写接口需要网站会话令牌。
- 网站密码验证成功后，随机会话令牌保存在当前浏览器，最长 180 天；仓库中不保存明文密码。密码哈希是公开配置，弱密码仍可能被离线猜测，因此它只作为页面操作门槛，不等同于私有数据保护。
- GitHub Pages 本质上仍是公开静态托管：密码能阻止普通访客进入页面操作，但不能把已发布的 `site/data/*.json` 变成真正私有数据。若岗位结果必须保密，应改用私有托管或服务端鉴权后再返回数据。
- OCR 图片只存在于 Actions 临时目录，处理完立即删除。
- 文章和岗位判断可能存在误差，最终以招聘单位官网为准。
