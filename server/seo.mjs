import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, rootDir } from "./config.mjs";
import { getPaper } from "./arxiv.mjs";
import { getTopic } from "./topics.mjs";

const indexFile = path.join(rootDir, "public", "index.html");
let templateCache = null;

async function template() {
  if (!templateCache) templateCache = await readFile(indexFile, "utf8");
  return templateCache;
}

function escapeAttr(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

async function metaForPath(pathname) {
  const base = {
    title: "乔木 arXiv — AI 精选论文，中文解读，一键读原文",
    description: "中文优先的 arXiv 论文发现站：AI 每日精选值得看的论文，主题策展、全文搜索、一键下载 PDF 与在线阅读，DeepSeek 驱动的中文解读与推荐。",
    path: "/"
  };

  const paperMatch = pathname.match(/^\/paper\/(.+?)\/?$/);
  if (paperMatch) {
    try {
      const paper = await getPaper(decodeURIComponent(paperMatch[1]));
      if (paper) {
        return {
          title: `${paper.title} · 乔木 arXiv`,
          description: paper.summary.slice(0, 150),
          path: `/paper/${paper.id}`
        };
      }
    } catch {
      // fall through to default
    }
  }

  const topicMatch = pathname.match(/^\/topic\/([\w-]+)\/?$/);
  if (topicMatch) {
    const topic = getTopic(topicMatch[1]);
    if (topic) {
      return {
        title: `${topic.name} · 主题策展 · 乔木 arXiv`,
        description: `${topic.tagline}。乔木 arXiv 主题策展：${topic.name}方向的最新优质论文，附 AI 中文解读。`,
        path: `/topic/${topic.id}`
      };
    }
  }

  if (pathname.startsWith("/search")) {
    return { ...base, title: "搜索论文 · 乔木 arXiv", path: "/search" };
  }
  if (pathname.startsWith("/classics")) {
    return {
      title: "经典论文 50 篇 · AI 发展史上的里程碑 · 乔木 arXiv",
      description: "AI 发展历史上最重要的 50 篇论文：Transformer、BERT、GPT、ResNet、GAN、扩散模型……标题与简介双语对照，一键下载 PDF 与 AI 中文解读。",
      path: "/classics"
    };
  }
  if (pathname.startsWith("/discover")) {
    return {
      title: "搜索下载 · 用人话找论文 · 乔木 arXiv",
      description: "用中文自然语言描述你想看的方向，AI 理解后检索最合适的 arXiv 论文，标题自动翻译成中文，一键下载 PDF。",
      path: "/discover"
    };
  }
  return base;
}

export async function renderAppHtml(pathname) {
  const meta = await metaForPath(pathname);
  const canonical = `${config.publicBaseUrl}${meta.path}`;
  const html = await template();
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.title)}</title>`)
    .replace(/\{\{META_DESCRIPTION\}\}/g, escapeAttr(meta.description))
    .replace(/\{\{META_TITLE\}\}/g, escapeAttr(meta.title))
    .replace(/\{\{CANONICAL\}\}/g, escapeAttr(canonical));
}

export function robotsTxt() {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${config.publicBaseUrl}/sitemap.xml`
  ].join("\n");
}

export async function sitemapXml() {
  const { topics } = await import("./topics.mjs");
  const urls = [
    { loc: "/", priority: "1.0" },
    { loc: "/classics", priority: "0.8" },
    { loc: "/discover", priority: "0.8" },
    ...topics.map((topic) => ({ loc: `/topic/${topic.id}`, priority: "0.7" }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url><loc>${config.publicBaseUrl}${u.loc}</loc><changefreq>daily</changefreq><priority>${u.priority}</priority></url>`
  )
  .join("\n")}
</urlset>`;
}
