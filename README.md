# 乔木 arXiv · qiaomu-arxiv

中文优先的 arXiv 论文发现站：AI 每日精选值得看的论文，主题策展、全文搜索、一键下载 PDF 与在线阅读，DeepSeek 驱动的中文解读与推荐引擎。

线上地址：<https://arxiv.qiaomu.ai>

## 功能

- **今日精选**：DeepSeek 每天从最新提交中挑出 6 篇值得读的论文，附中文看点与推荐理由（24 小时缓存）
- **主题策展**：12 个手工调过的研究方向（LLM 智能体、推理与思维链、扩散模型、视频生成、多模态、RAG、高效推理、具身智能、AI 安全、AI for Science、代码生成、长上下文），每个主题背后是精确的 arXiv 检索式
- **经典论文**：AI 发展史上最重要的 50 篇论文（word2vec → Transformer → 推理大模型），按年份时间线排列，标题与简介中英双语对照（DeepSeek 编译，数据静态内置）
- **搜索下载**：用人话描述需求，DeepSeek 理解意图后生成检索式查询 arXiv，结果标题自动翻译成中文；搜索框下方搜索词每 5 秒轮播，点击即搜
- **全文搜索**：关键词 / 作者 / 分类筛选 / 相关度与最新排序，输入 arXiv ID 直达论文页
- **一键阅读**：下载 PDF、arXiv 页面、HTML 全文三个入口
- **AI 解读**：基于摘要的流式中文解读（讲了什么 / 为什么值得看 / 方法速览 / 适合谁读 / 局限），结果落盘缓存，二次打开秒出
- **追问对话**：就当前论文继续提问，SSE 流式回答
- **收藏**：纯本地 localStorage，不需要账号
- SEO：论文页 / 主题页服务端注入 meta 与 canonical，自带 sitemap 与 robots

## 技术栈

零依赖 Node.js（≥ 20）：原生 `http` 服务 + 手写 Atom XML 解析 + vanilla JS 前端。没有框架、没有构建步骤。

- 数据来源：[arXiv API](https://info.arxiv.org/help/api/basics.html)，遵守 3 秒限速，磁盘缓存分级 TTL
- AI：[DeepSeek](https://api.deepseek.com) `deepseek-v4-flash`，SSE 流式转发；不配置 key 时 AI 功能自动降级为纯浏览
- 设计：暖纸色学术期刊 × 开发者工具风格，详见 [DESIGN.md](DESIGN.md)

## 本地运行

```bash
cp .env.example .env.local
# 填入 DEEPSEEK_API_KEY（可选，不配也能用浏览功能）
npm run dev          # http://127.0.0.1:4174
npm run check        # 语法与结构检查
npm run warm-featured  # 手动预热每日精选缓存
```

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key（AI 解读 / 精选 / 对话） | 空（AI 功能降级） |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `PORT` / `HOST` | 监听端口与地址 | `4174` / `127.0.0.1` |
| `PUBLIC_BASE_URL` | 站点公开地址（SEO / sitemap） | `https://arxiv.qiaomu.ai` |
| `STORAGE_DIR` | 缓存目录 | `storage` |

## 目录结构

```
server/
  index.mjs    # HTTP 服务、路由、AI 限流、SSE
  arxiv.mjs    # arXiv API 客户端、Atom 解析、限速队列、磁盘缓存
  ai.mjs       # DeepSeek：解读 / 追问 / 每日精选生成
  discover.mjs # 搜索下载：意图理解 + 检索 + 标题翻译
  classics.mjs # 经典论文 50 篇静态数据读取
  topics.mjs   # 主题策展、分类筛选、搜索词轮播配置
  seo.mjs      # meta 注入、sitemap、robots
  config.mjs   # 环境变量与 .env.local 加载
  data/        # classics-seed.json（种子）与 classics.json（生成结果，提交入库）
public/        # 前端三件套（index.html / styles.css / app.js）
scripts/       # check / warm-featured / generate-classics
```

## 部署

任何支持 Node 20+ 的环境即可，推荐 Docker + Caddy/Nginx 反代。服务无状态依赖（缓存可丢），单进程运行。

## 致谢

论文数据来自 [arXiv.org](https://arxiv.org/)，遵循其 API 使用条款。AI 解读基于摘要生成，仅供参考，细节请阅读原文。

## License

MIT © [向阳乔木](https://qiaomu.ai)
