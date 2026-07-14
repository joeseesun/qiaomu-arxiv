import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, rootDir, runtimeStatus } from "./config.mjs";
import { getPaper, latestPapers, recentPool, searchPapers, slimPaper, topicPapers } from "./arxiv.mjs";
import { categoryFilters, featuredCategories, getTopic, topics } from "./topics.mjs";
import { aiEnabled, generateFeatured, readFeatured, streamChat, streamExplain } from "./ai.mjs";
import { renderAppHtml, robotsTxt, sitemapXml } from "./seo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"]
]);

function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 512 * 1024) {
        reject(new Error("request_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// --- AI 接口限流：每 IP 每小时 30 次 ---
const aiLimits = new Map();
const AI_WINDOW_MS = 60 * 60 * 1000;
const AI_MAX = 30;

function checkAiLimit(ip) {
  const now = Date.now();
  const entry = aiLimits.get(ip);
  if (!entry || now - entry.windowStart > AI_WINDOW_MS) {
    aiLimits.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: AI_MAX - 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= AI_MAX, remaining: Math.max(0, AI_MAX - entry.count) };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of aiLimits) {
    if (now - entry.windowStart > AI_WINDOW_MS * 2) aiLimits.delete(ip);
  }
}, 10 * 60 * 1000).unref();

function sseHead(res, extraHeaders = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...extraHeaders
  });
}

// --- 每日精选：缓存优先，过期后台重生 ---
let featuredRegenerating = null;

async function ensureFeatured() {
  const cached = await readFeatured();
  if (cached) return { ...cached, ai: true };
  if (aiEnabled() && !featuredRegenerating) {
    featuredRegenerating = recentPool(featuredCategories)
      .then((pool) => generateFeatured(pool))
      .catch(() => null)
      .finally(() => {
        featuredRegenerating = null;
      });
  }
  // 无缓存时先回退到最新论文流，AI 选完再换
  try {
    const { entries } = await latestPapers({ max: 6 });
    return {
      generatedAt: new Date().toISOString(),
      ai: false,
      picks: entries.map((paper) => ({ paper, headline: "", reason: "", audience: "" }))
    };
  } catch {
    return { generatedAt: new Date().toISOString(), ai: false, picks: [] };
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { ok: true, ...runtimeStatus() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/featured") {
    const featured = await ensureFeatured();
    json(res, 200, {
      generatedAt: featured.generatedAt,
      ai: featured.ai,
      picks: featured.picks.map((pick) => ({
        paper: slimPaper(pick.paper),
        headline: pick.headline,
        reason: pick.reason,
        audience: pick.audience
      }))
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/topics") {
    json(res, 200, { topics, categoryFilters });
    return;
  }

  const topicMatch = url.pathname.match(/^\/api\/topic\/([\w-]+)$/);
  if (req.method === "GET" && topicMatch) {
    const topic = getTopic(topicMatch[1]);
    if (!topic) {
      json(res, 404, { error: "topic_not_found" });
      return;
    }
    const start = Math.max(0, Number(url.searchParams.get("start") || 0));
    const { total, entries } = await topicPapers(topic, { start, max: 20 });
    json(res, 200, {
      topic: { id: topic.id, name: topic.name, tagline: topic.tagline },
      papers: entries.map(slimPaper),
      total,
      start,
      hasMore: start + entries.length < total && start + entries.length < 200
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/latest") {
    const start = Math.max(0, Number(url.searchParams.get("start") || 0));
    const { total, entries } = await latestPapers({ start, max: 20 });
    json(res, 200, { papers: entries.map(slimPaper), total, start, hasMore: start + entries.length < total });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q || q.length > 200) {
      json(res, 400, { error: "bad_query", message: "请输入 1-200 字符的搜索词。" });
      return;
    }
    const start = Math.max(0, Number(url.searchParams.get("start") || 0));
    const { total, entries } = await searchPapers({
      q,
      cat: url.searchParams.get("cat") || "",
      sort: url.searchParams.get("sort") || "relevance",
      start,
      max: 20
    });
    json(res, 200, {
      papers: entries.map(slimPaper),
      total,
      start,
      hasMore: start + entries.length < total && start + entries.length < 200
    });
    return;
  }

  const paperMatch = url.pathname.match(/^\/api\/paper\/(.+)$/);
  if (req.method === "GET" && paperMatch) {
    const paper = await getPaper(decodeURIComponent(paperMatch[1]));
    if (!paper) {
      json(res, 404, { error: "paper_not_found", message: "没有找到这篇论文，检查 ID 是否正确。" });
      return;
    }
    json(res, 200, { paper });
    return;
  }

  const explainMatch = url.pathname.match(/^\/api\/paper\/(.+)\/explain$/);
  if (req.method === "POST" && explainMatch) {
    const ip = getClientIp(req);
    const { allowed, remaining } = checkAiLimit(ip);
    if (!allowed) {
      res.setHeader("Retry-After", "3600");
      json(res, 429, { error: "rate_limited", message: "AI 解读每小时限 30 次，请稍后再试。" });
      return;
    }
    const paper = await getPaper(decodeURIComponent(explainMatch[1]));
    if (!paper) {
      json(res, 404, { error: "paper_not_found" });
      return;
    }
    sseHead(res, { "X-AI-Remaining": String(remaining) });
    await streamExplain(res, paper);
    res.end();
    return;
  }

  const chatMatch = url.pathname.match(/^\/api\/paper\/(.+)\/chat$/);
  if (req.method === "POST" && chatMatch) {
    const ip = getClientIp(req);
    const { allowed, remaining } = checkAiLimit(ip);
    if (!allowed) {
      res.setHeader("Retry-After", "3600");
      json(res, 429, { error: "rate_limited", message: "AI 对话每小时限 30 次，请稍后再试。" });
      return;
    }
    const paper = await getPaper(decodeURIComponent(chatMatch[1]));
    if (!paper) {
      json(res, 404, { error: "paper_not_found" });
      return;
    }
    const body = await parseBody(req);
    sseHead(res, { "X-AI-Remaining": String(remaining) });
    await streamChat(res, paper, body.messages);
    res.end();
    return;
  }

  json(res, 404, { error: "not_found" });
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return path.join(publicDir, normalized === "/" ? "index.html" : normalized);
}

async function servePublic(req, res, url) {
  if (req.method === "GET" || req.method === "HEAD") {
    if (url.pathname === "/robots.txt") {
      res.setHeader("Content-Type", mimeTypes.get(".txt"));
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(req.method === "HEAD" ? "" : robotsTxt());
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      res.setHeader("Content-Type", mimeTypes.get(".xml"));
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(req.method === "HEAD" ? "" : await sitemapXml());
      return;
    }
    if (url.pathname === "/" || /^\/(paper|topic|search)(\/|$)/.test(url.pathname)) {
      res.setHeader("Content-Type", mimeTypes.get(".html"));
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(req.method === "HEAD" ? "" : await renderAppHtml(url.pathname));
      return;
    }
  }

  let filePath = safePublicPath(url.pathname);
  if (!existsSync(filePath) || !filePath.startsWith(publicDir)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.setHeader("Content-Type", mimeTypes.get(ext) || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=3600");
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      await servePublic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        console.error("handler error after headers sent:", error);
        res.end();
        return;
      }
      json(res, error.message === "invalid_json" ? 400 : 500, {
        error: "server_error",
        message: error.message
      });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(config.port, config.host, async () => {
    const pkg = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
    console.log(`${pkg.name} running at http://${config.host}:${config.port}`);
    // 启动时预生成每日精选（不阻塞服务）
    if (aiEnabled()) {
      readFeatured().then((cached) => {
        if (!cached) ensureFeatured();
      });
    }
  });
}
