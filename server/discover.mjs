// 搜索下载：自然语言问句 → DeepSeek 理解 → arXiv 检索 → 标题批量翻译
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { aiEnabled } from "./ai.mjs";
import { searchPapers, slimPaper } from "./arxiv.mjs";
import { categoryFilters } from "./topics.mjs";

const discoverDir = path.join(config.storageDir, "discover");
const titlesFile = path.join(config.storageDir, "titles.json");
const DISCOVER_TTL_MS = 24 * 60 * 60 * 1000;

const VALID_CATS = new Set(categoryFilters.map((c) => c.id).filter(Boolean));

async function deepseekJson(messages, { maxTokens = 600, timeoutMs = 45000 } = {}) {
  const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      thinking: { type: "disabled" },
      messages,
      max_tokens: maxTokens,
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`deepseek_http_${res.status}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content || "";
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start === -1 || end === -1) throw new Error("no_json");
  return JSON.parse(raw.slice(start, end + 1));
}

// --- 标题翻译：持久映射，增量翻译 ---
let titleMap = null;

async function loadTitleMap() {
  if (titleMap) return titleMap;
  try {
    titleMap = JSON.parse(await readFile(titlesFile, "utf8"));
  } catch {
    titleMap = {};
  }
  return titleMap;
}

async function saveTitleMap() {
  await mkdir(config.storageDir, { recursive: true });
  await writeFile(titlesFile, JSON.stringify(titleMap), "utf8").catch(() => {});
}

export async function translateTitles(papers) {
  const map = await loadTitleMap();
  const pending = papers.filter((p) => !map[p.id]);
  if (pending.length && aiEnabled()) {
    try {
      const translated = await deepseekJson(
        [
          {
            role: "system",
            content:
              '把论文标题翻译成中文，忠实原意，术语保留英文原词。只输出 JSON 数组：[{"id":"...","zh":"..."}]，不要任何额外文字。'
          },
          { role: "user", content: JSON.stringify(pending.map((p) => ({ id: p.id, title: p.title }))) }
        ],
        { maxTokens: 2000 }
      );
      let changed = false;
      for (const item of translated) {
        if (item?.id && item?.zh) {
          map[item.id] = String(item.zh).slice(0, 80);
          changed = true;
        }
      }
      if (changed) await saveTitleMap();
    } catch {
      // 翻译失败不阻塞检索结果
    }
  }
  return papers.map((p) => ({ ...slimPaper(p), titleZh: map[p.id] || "" }));
}

// --- 问句理解 ---
function fallbackInterpret(q) {
  // 无 AI 时：原样当关键词检索
  return { terms: [String(q).slice(0, 60)], cat: "", note: "" };
}

async function interpret(q) {
  if (!aiEnabled()) return fallbackInterpret(q);
  try {
    const result = await deepseekJson([
      {
        role: "system",
        content: [
          "你是 arXiv 检索专家。用户用中文自然语言描述想找的论文，你把它转成 arXiv API 的英文检索要素。",
          '只输出 JSON：{"terms":["英文短语1","英文短语2"],"cat":"分类或空串","note":"≤30字中文，说明你打算怎么检索"}',
          "terms 最多 3 个，用学者真正会写在标题/摘要里的英文术语，短语可带空格；",
          `cat 只能从这里面选或留空：${[...VALID_CATS].join(", ")}；`,
          "不要输出布尔运算符，不要编造 arXiv ID。"
        ].join("\n")
      },
      { role: "user", content: String(q).slice(0, 300) }
    ]);
    const terms = (Array.isArray(result.terms) ? result.terms : [])
      .map((t) => String(t).replace(/[^\w\s-]/g, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!terms.length) return fallbackInterpret(q);
    return {
      terms,
      cat: VALID_CATS.has(result.cat) ? result.cat : "",
      note: String(result.note || "").slice(0, 60)
    };
  } catch {
    return fallbackInterpret(q);
  }
}

export async function discover(q) {
  const question = String(q || "").trim();
  if (!question || question.length > 300) throw new Error("bad_query");

  const key = createHash("sha1").update(question).digest("hex");
  const file = path.join(discoverDir, `${key}.json`);
  let stale;
  let hasStale = false;
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (cached.expires > Date.now()) return cached.data;
    stale = cached.data;
    hasStale = true;
  } catch {
    // miss
  }

  try {
    const plan = await interpret(question);
    const searchQuery =
      plan.terms.map((t) => (t.includes(" ") ? `all:"${t}"` : `all:${t}`)).join(" AND ") +
      (plan.cat ? ` AND cat:${plan.cat}` : "");
    const { entries, total } = await searchPapers({ q: plan.terms.join(" "), cat: plan.cat, sort: "relevance", max: 20 });
    const papers = await translateTitles(entries);
    const data = {
      question,
      note: plan.note,
      terms: plan.terms,
      cat: plan.cat,
      queryUsed: searchQuery,
      total,
      papers
    };

    await mkdir(discoverDir, { recursive: true });
    await writeFile(file, JSON.stringify({ expires: Date.now() + DISCOVER_TTL_MS, data }), "utf8").catch(() => {});
    return data;
  } catch (error) {
    // 兜底：检索失败时返回过期缓存
    if (hasStale) return stale;
    throw error;
  }
}
