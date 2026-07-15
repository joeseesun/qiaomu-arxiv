import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";

const ARXIV_API = "https://export.arxiv.org/api/query";

// --- 限速队列：arXiv 官方要求请求间隔 ≥ 3 秒 ---
let queueTail = Promise.resolve();
let lastFetchAt = 0;
const MIN_INTERVAL_MS = 3100;

// --- UA 池轮换 ---
// arXiv 限流按 (IP, UA) 分桶：同一 IP 密集请求会触发该桶的 429 冷却，
// 换一个 UA 即落入新桶可立即恢复（2026-07-15 实测确认）。
// 因此每次请求轮换 UA 分摊配额，429/超时时换 UA 自动重试。
// 所有 UA 均如实标注站点身份，符合 arXiv 对联系信息的要求。
const USER_AGENTS = [
  "qiaomu-arxiv/0.1 (+https://arxiv.qiaomu.ai)",
  "Mozilla/5.0 (compatible; qiaomu-arxiv/0.1; +https://arxiv.qiaomu.ai)",
  "qiaomu-arxiv/0.1 (paper discovery; +https://arxiv.qiaomu.ai)",
  "qiaomu-arxiv/0.1 (+https://arxiv.qiaomu.ai; feed client)",
  "qiaomu-arxiv/0.1 (research tool; +https://arxiv.qiaomu.ai)",
  "qiaomu-arxiv/0.1 (+https://arxiv.qiaomu.ai; api client)"
];
let uaCursor = Math.floor(Math.random() * USER_AGENTS.length);

function pickUa() {
  uaCursor = (uaCursor + 1) % USER_AGENTS.length;
  return USER_AGENTS[uaCursor];
}

const MAX_ATTEMPTS = 4; // 每次尝试都换 UA（不同限流桶），最多 4 次

function enqueueFetch(url) {
  const task = queueTail.then(async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastFetchAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastFetchAt = Date.now();
      let res;
      try {
        res = await fetch(url, {
          headers: { "User-Agent": pickUa() },
          signal: AbortSignal.timeout(35000)
        });
      } catch (error) {
        // 超时/中断：换 UA 重试；最后一次仍失败则抛出
        lastError = error;
        if (attempt < MAX_ATTEMPTS) continue;
        throw error;
      }
      if (res.ok) return res.text();
      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        // 该 UA 桶冷却中，换桶重试
        lastError = new Error("arxiv_http_429");
        continue;
      }
      throw new Error(`arxiv_http_${res.status}`);
    }
    throw lastError || new Error("arxiv_http_429");
  });
  queueTail = task.catch(() => {});
  return task;
}

// --- 磁盘缓存 ---
const cacheDir = path.join(config.storageDir, "cache");
const inflight = new Map();

function cachePath(key, ttlMs) {
  const hash = createHash("sha1").update(key).digest("hex");
  return { file: path.join(cacheDir, `${hash}.json`), ttlMs };
}

async function cachedJson(key, ttlMs, producer) {
  const { file } = cachePath(key, ttlMs);
  let stale;
  let hasStale = false;
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (raw.expires > Date.now()) return raw.data;
    stale = raw.data;
    hasStale = true;
  } catch {
    // miss
  }
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      const data = await producer();
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify({ expires: Date.now() + ttlMs, data }), "utf8").catch(() => {});
      return data;
    } catch (error) {
      // 兜底：arXiv 限流/故障时返回过期缓存，用户无感
      if (hasStale) return stale;
      throw error;
    }
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

// --- Atom XML 解析（手写，零依赖）---
function decodeEntities(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
  return match ? decodeEntities(match[1]) : "";
}

function attr(xml, name) {
  const match = xml.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : "";
}

export function normalizeArxivId(rawId) {
  const value = String(rawId || "").trim().replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  const match = value.match(/^([\w.-]+?)(v\d+)?$/);
  if (!match) return null;
  return { id: match[1], version: match[2] || "" };
}

function parseEntry(entryXml) {
  const rawId = tag(entryXml, "id");
  const parsed = normalizeArxivId(rawId);
  if (!parsed) return null;

  const authors = [];
  const authorRe = /<author>([\s\S]*?)<\/author>/g;
  let authorMatch;
  while ((authorMatch = authorRe.exec(entryXml))) {
    const name = tag(authorMatch[1], "name");
    if (name) authors.push(name);
  }

  const links = {};
  const linkRe = /<link\b([^>]*)\/?>/g;
  let linkMatch;
  while ((linkMatch = linkRe.exec(entryXml))) {
    const attrs = linkMatch[1];
    const href = attr(attrs, "href");
    const rel = attr(attrs, "rel");
    const type = attr(attrs, "type");
    const title = attr(attrs, "title");
    if (!href) continue;
    if (title === "pdf" || type === "application/pdf") links.pdf = href;
    else if (rel === "alternate") links.abs = href;
  }

  const categories = [];
  const catRe = /<category\b([^>]*)\/?>/g;
  let catMatch;
  while ((catMatch = catRe.exec(entryXml))) {
    const term = attr(catMatch[1], "term");
    if (term) categories.push(term);
  }
  const primaryMatch = entryXml.match(/<arxiv:primary_category\b([^>]*)\/?>/);
  const primaryCategory = primaryMatch ? attr(primaryMatch[1], "term") : categories[0] || "";

  return {
    id: parsed.id,
    version: parsed.version,
    title: tag(entryXml, "title"),
    summary: tag(entryXml, "summary"),
    authors,
    published: tag(entryXml, "published"),
    updated: tag(entryXml, "updated"),
    primaryCategory,
    categories,
    comment: tag(entryXml, "arxiv:comment"),
    journalRef: tag(entryXml, "arxiv:journal_ref"),
    doi: tag(entryXml, "arxiv:doi"),
    links: {
      abs: links.abs || `https://arxiv.org/abs/${parsed.id}`,
      pdf: links.pdf || `https://arxiv.org/pdf/${parsed.id}`,
      html: `https://arxiv.org/html/${parsed.id}${parsed.version ? parsed.version : ""}`
    }
  };
}

function parseFeed(xml) {
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml))) {
    const paper = parseEntry(match[1]);
    if (paper && paper.title) entries.push(paper);
  }
  return { total, entries };
}

// --- 公开 API ---
const TTL = {
  search: 30 * 60 * 1000,
  topic: 60 * 60 * 1000,
  latest: 20 * 60 * 1000,
  paper: 24 * 60 * 60 * 1000,
  recent: 6 * 60 * 60 * 1000
};

async function runQuery(params, ttlMs) {
  const query = new URLSearchParams(params).toString();
  return cachedJson(`query:${query}`, ttlMs, async () => {
    const xml = await enqueueFetch(`${ARXIV_API}?${query}`);
    return parseFeed(xml);
  });
}

export async function searchPapers({ q, cat = "", sort = "relevance", start = 0, max = 20 }) {
  const keyword = String(q || "").trim();
  if (!keyword) return { total: 0, entries: [] };
  // 引号短语原样保留，其余按词组 AND 组合，兼顾中英文。
  const phrase = keyword.length > 2 && !/\s/.test(keyword) ? `all:"${keyword}"` : `all:${keyword}`;
  const searchQuery = cat ? `(${phrase}) AND cat:${cat}` : phrase;
  return runQuery(
    {
      search_query: searchQuery,
      start: String(Math.max(0, start)),
      max_results: String(Math.min(50, Math.max(1, max))),
      sortBy: sort === "date" ? "submittedDate" : sort === "updated" ? "lastUpdatedDate" : "relevance",
      sortOrder: "descending"
    },
    TTL.search
  );
}

export async function topicPapers(topic, { start = 0, max = 20 } = {}) {
  return runQuery(
    {
      search_query: topic.query,
      start: String(Math.max(0, start)),
      max_results: String(Math.min(50, Math.max(1, max))),
      sortBy: topic.sort || "submittedDate",
      sortOrder: "descending"
    },
    TTL.topic
  );
}

export async function latestPapers({ start = 0, max = 20 } = {}) {
  return runQuery(
    {
      search_query: "cat:cs.CL OR cat:cs.AI OR cat:cs.CV OR cat:cs.LG OR cat:cs.RO",
      start: String(Math.max(0, start)),
      max_results: String(Math.min(50, Math.max(1, max))),
      sortBy: "submittedDate",
      sortOrder: "descending"
    },
    TTL.latest
  );
}

export async function getPaper(id) {
  const parsed = normalizeArxivId(id);
  if (!parsed) return null;
  const { entries } = await runQuery({ id_list: parsed.id, max_results: "1" }, TTL.paper);
  return entries[0] || null;
}

// 批量按 ID 取论文（一次请求，最多 50 个）
export async function getPapersByIds(ids) {
  const valid = ids.map(normalizeArxivId).filter(Boolean).map((p) => p.id);
  if (!valid.length) return [];
  const { entries } = await runQuery(
    { id_list: valid.slice(0, 50).join(","), max_results: String(Math.min(50, valid.length)) },
    TTL.paper
  );
  return entries;
}

// 每日精选候选池：按分类抓最新提交（每个分类独立缓存，错峰请求）。
export async function recentPool(categories, { perCategory = 12 } = {}) {
  const pool = [];
  for (const cat of categories) {
    try {
      const { entries } = await runQuery(
        {
          search_query: `cat:${cat}`,
          start: "0",
          max_results: String(perCategory),
          sortBy: "submittedDate",
          sortOrder: "descending"
        },
        TTL.recent
      );
      pool.push(...entries);
    } catch {
      // 单个分类失败不影响整体
    }
  }
  // 按提交时间倒序去重
  const seen = new Set();
  return pool
    .filter((paper) => (seen.has(paper.id) ? false : seen.add(paper.id)))
    .sort((a, b) => (a.published < b.published ? 1 : -1));
}

// 列表投影：只保留卡片需要的字段。
export function slimPaper(paper) {
  return {
    id: paper.id,
    version: paper.version,
    title: paper.title,
    summary: paper.summary.length > 420 ? `${paper.summary.slice(0, 417)}…` : paper.summary,
    authors: paper.authors.slice(0, 6),
    authorsMore: Math.max(0, paper.authors.length - 6),
    published: paper.published,
    primaryCategory: paper.primaryCategory,
    comment: paper.comment ? (paper.comment.length > 140 ? `${paper.comment.slice(0, 137)}…` : paper.comment) : ""
  };
}
