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
  - [x] 代码开源到 GitHub
  - [ ] DNS
  - [ ] VPS 部署 + systemd
  - [ ] Nginx + TLS
  - [ ] Umami + 验收
