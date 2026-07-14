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
