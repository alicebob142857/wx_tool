# 文管求职雷达

每天读取 10 个微信公众号的最新推送，从网页正文和图片 OCR 中提取招聘信息，再使用 DeepSeek 判断是否适合文科或管理类毕业生。结果发布为 GitHub Pages；微信扫码登录会话由 Cloudflare Worker + KV 保存，不依赖个人电脑常驻。

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
  ├─ DeepSeek：文科/管理类岗位判断
  └─ GitHub Pages：发布日报与授权二维码

Cloudflare Worker
  ├─ KV：保存最多 4 天的微信会话
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

2. 创建 KV：

   ```bash
   npx wrangler kv namespace create AUTH_KV
   ```

3. 把命令返回的 namespace ID 写入 `worker/wrangler.jsonc`。

4. 设置一个随机的服务端令牌：

   ```bash
   npx wrangler secret put COLLECTOR_TOKEN --config worker/wrangler.jsonc
   ```

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
- Pages 仅公开二维码、授权状态和筛选后的日报。
- OCR 图片只存在于 Actions 临时目录，处理完立即删除。
- 文章和岗位判断可能存在误差，最终以招聘单位官网为准。

