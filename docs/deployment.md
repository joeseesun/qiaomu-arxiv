# 部署记录 — arxiv.qiaomu.ai

## 2026-07-14 首次上线

- 目标：qiaomu-arxiv（GitHub: joeseesun/qiaomu-arxiv）部署到 myvps，域名 arxiv.qiaomu.ai
- 参照：aha-imdb-top250（systemd + Nginx vhost + Let's Encrypt）
- 方案：
  - 应用目录 `/opt/qiaomu-apps/qiaomu-arxiv`（git clone，www:www）
  - systemd 服务 `qiaomu-arxiv.service`，EnvironmentFile `/etc/qiaomu-arxiv.env`
  - 端口 127.0.0.1:3208（ss 确认空闲）
  - Nginx vhost `/www/server/panel/vhost/nginx/arxiv.qiaomu.ai.conf`，443 反代到 3208
  - DNS：Cloudflare A 记录 arxiv → 76.13.103.27（proxied=false）
  - TLS：certbot webroot `/www/wwwroot/arxiv.qiaomu.ai`
  - Umami：复用 umami.qiaomu.ai，单独 website 条目
- 进展：
  - [x] 代码开源到 GitHub（joeseesun/qiaomu-arxiv）
  - [x] DNS：A 记录 arxiv → 76.13.103.27（proxied=false）
  - [x] VPS 部署：`/opt/qiaomu-apps/qiaomu-arxiv`，systemd `qiaomu-arxiv.service`（127.0.0.1:3208，env `/etc/qiaomu-arxiv.env`）
  - [x] Nginx + TLS：vhost `/www/server/panel/vhost/nginx/arxiv.qiaomu.ai.conf`，cert `/etc/letsencrypt/live/arxiv.qiaomu.ai/`
  - [x] Umami：website `qiaomu-arxiv` / ID `2b977e8c-b464-4412-b244-64827d9b2231`
  - [x] 线上验收：首页 / 论文页 meta / SSE 流式解读 / sitemap / robots / 零 console 报错
- 运行方式：git pull 更新代码后 `systemctl restart qiaomu-arxiv`；缓存目录 `storage/`（ReadWritePaths 已放行）
- 备注：reward / 关注 / 乔木推荐 等站群 affordances 本次未加，保持页面干净，需要再加

## 2026-07-15 二期：经典论文 + 搜索下载

- 新增「经典论文」：AI 史上 50 篇里程碑论文，年份时间线 + 中英双语标题/简介
  - 数据：`server/data/classics-seed.json`（人工校准 ID + 英文标题）→ `scripts/generate-classics.mjs`（DeepSeek 生成双语）→ `server/data/classics.json`（提交入库，运行时静态读）
  - 生成不依赖 arXiv API（限流严格），只调一次 DeepSeek
- 新增「搜索下载」：中文自然语言 → DeepSeek 生成 arXiv 检索式 → 结果标题批量翻译（`storage/titles.json` 持久缓存），查询结果缓存 24h（`storage/discover/`）
  - 搜索词轮播 18 条，每 5 秒切换，点击即搜；`/discover?q=` 支持深链
- 运维踩坑：
  - arXiv 429 是短时冷却（IP+UA 维度），密集测试触发后需停手等数分钟，继续请求会延长冷却
  - export.arxiv.org 偶发响应 >20s，fetch 超时已调到 35s（`server/arxiv.mjs`）
  - discover 错误已映射为友好中文提示（429/超时/上游错误）
  - 建议上线后预热 18 条 suggestion 查询缓存，用户点击即秒出
- 限流根治（同日）：`server/arxiv.mjs` 加入 UA 池（6 个如实标注站点的 UA），每次请求轮换分摊 (IP,UA) 桶配额；429/超时自动换 UA 重试，最多 4 次。mock 测试 6 场景全过（429 重试成功 / 全 429 抛错 / 超时重试 / 直过 / 500 不重试 / 过期缓存兜底）
- 过期缓存兜底：arXiv 故障或全部 UA 桶冷却时，`cachedJson` 与 discover 均返回已过期的旧缓存而不是报错，用户无感。注意 UA 池不宜再大——轮换太多在 arXiv 日志里是明显规避模式，有整 IP 被封风险；4~6 个是正常客户端与规避的分界线
