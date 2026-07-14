import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";

const FEATURED_FILE = path.join(config.storageDir, "featured.json");
const explainDir = path.join(config.storageDir, "explain");
const FEATURED_TTL_MS = 24 * 60 * 60 * 1000;

export function aiEnabled() {
  return Boolean(config.deepseekApiKey);
}

function chatUrl() {
  return `${config.deepseekBaseUrl}/v1/chat/completions`;
}

async function deepseekRequest(payload, { timeoutMs = 60000 } = {}) {
  const res = await fetch(chatUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(`deepseek_http_${res.status}`);
    error.detail = text.slice(0, 300);
    throw error;
  }
  return res;
}

// --- 论文解读：流式输出，完成后落盘缓存 ---

function paperContext(paper) {
  const parts = [
    `标题：${paper.title}`,
    `arXiv ID：${paper.id}${paper.version ? ` (${paper.version})` : ""}`,
    `作者：${paper.authors.slice(0, 10).join("、")}${paper.authors.length > 10 ? " 等" : ""}`,
    `分类：${paper.categories.join(", ")}`,
    `提交时间：${paper.published?.slice(0, 10) || "未知"}`
  ];
  if (paper.comment) parts.push(`作者备注：${paper.comment}`);
  if (paper.journalRef) parts.push(`发表信息：${paper.journalRef}`);
  parts.push(`摘要：${paper.summary}`);
  return parts.join("\n");
}

const EXPLAIN_SYSTEM = [
  "你是「乔木 arXiv」的论文解读编辑，面向中文 AI 从业者、研究者和学习者。",
  "基于论文的标题、摘要和元数据写解读，不要假装读过全文；摘要里没有的信息坦诚说不确定。",
  "解读结构（用 Markdown，不要额外开场白）：",
  "1. **一句话说清**这篇论文做了什么；",
  "2. **为什么值得看**：它解决了什么问题、和已有工作比新在哪；",
  "3. **方法速览**：3-5 个要点讲清核心技术思路；",
  "4. **适合谁读**：按背景给出阅读建议；",
  "5. **局限与疑点**：基于摘要能看出的边界。",
  "用中文，术语保留英文原词，克制、有判断，禁止「革命性」「颠覆」式营销腔。"
].join("\n");

function explainCacheFile(id) {
  const safe = String(id).replace(/[^\w.-]/g, "_");
  return path.join(explainDir, `${safe}.json`);
}

export function writeSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamFromCache(res, text) {
  // 缓存命中也切片输出，保留阅读节奏
  const sliceSize = 12;
  for (let i = 0; i < text.length; i += sliceSize) {
    writeSse(res, { type: "delta", text: text.slice(i, i + sliceSize) });
    await new Promise((resolve) => setTimeout(resolve, 6));
  }
  writeSse(res, { type: "done", cached: true });
}

export async function streamExplain(res, paper) {
  if (!aiEnabled()) {
    writeSse(res, { type: "error", error: "AI 服务未配置" });
    return;
  }
  const cacheFile = explainCacheFile(paper.id);
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8"));
    if (cached.text && cached.title === paper.title) {
      await streamFromCache(res, cached.text);
      return;
    }
  } catch {
    // miss
  }

  try {
    const upstream = await deepseekRequest({
      model: config.deepseekModel,
      stream: true,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM },
        { role: "user", content: `请解读这篇论文：\n\n${paperContext(paper)}` }
      ],
      max_tokens: 1400,
      temperature: 0.4
    });
    if (!upstream.body) throw new Error("no_body");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            writeSse(res, { type: "delta", text: delta });
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }
    if (full.length > 100) {
      await mkdir(explainDir, { recursive: true });
      await writeFile(
        cacheFile,
        JSON.stringify({ id: paper.id, title: paper.title, createdAt: Date.now(), text: full }),
        "utf8"
      ).catch(() => {});
    }
    writeSse(res, { type: "done" });
  } catch (error) {
    writeSse(res, {
      type: "error",
      error: error?.name === "TimeoutError" ? "AI 响应超时，请重试" : "AI 服务暂时不可用，请稍后重试"
    });
  }
}

// --- 追问对话：流式，不缓存 ---

function sanitizeTurns(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    .slice(-10);
}

export async function streamChat(res, paper, rawTurns) {
  if (!aiEnabled()) {
    writeSse(res, { type: "error", error: "AI 服务未配置" });
    return;
  }
  const turns = sanitizeTurns(rawTurns);
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    writeSse(res, { type: "error", error: "需要至少一条用户消息" });
    return;
  }
  try {
    const upstream = await deepseekRequest({
      model: config.deepseekModel,
      stream: true,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content: [
            "你是「乔木 arXiv」的论文助手，用户正在浏览一篇论文的详情页。",
            "你只能基于下面的论文信息（标题、摘要、元数据）回答，没读过全文；",
            "涉及全文细节、实验数字、图表内容时，坦诚说明摘要中没有，不要编造。",
            "可以帮用户理解术语、比较相关方向、建议接下来读什么。用中文，简洁有判断，可用 Markdown 列表。"
          ].join("\n")
        },
        { role: "user", content: `当前论文信息：\n${paperContext(paper)}` },
        { role: "assistant", content: "已读取这篇论文的摘要信息，有什么想问的？" },
        ...turns
      ],
      max_tokens: 900,
      temperature: 0.5
    });
    if (!upstream.body) throw new Error("no_body");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) writeSse(res, { type: "delta", text: delta });
        } catch {
          // ignore
        }
      }
    }
    writeSse(res, { type: "done" });
  } catch (error) {
    writeSse(res, {
      type: "error",
      error: error?.name === "TimeoutError" ? "AI 响应超时，请重试" : "AI 服务暂时不可用，请稍后重试"
    });
  }
}

// --- 每日精选：AI 从候选池挑选，缓存 24 小时 ---

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("no_json_array");
  return JSON.parse(raw.slice(start, end + 1));
}

export async function readFeatured() {
  try {
    const cached = JSON.parse(await readFile(FEATURED_FILE, "utf8"));
    if (cached.expires > Date.now() && Array.isArray(cached.picks)) return cached;
  } catch {
    // miss
  }
  return null;
}

export async function generateFeatured(pool) {
  if (!aiEnabled() || !pool.length) return null;

  const candidates = pool.slice(0, 48).map((paper) => ({
    id: paper.id,
    title: paper.title,
    cat: paper.primaryCategory,
    date: paper.published?.slice(0, 10),
    summary: paper.summary.slice(0, 320)
  }));

  const res = await deepseekRequest(
    {
      model: config.deepseekModel,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content: [
            "你是「乔木 arXiv」的主编，为中文 AI 从业者从最新论文里挑今天最值得读的 6 篇。",
            "标准：问题重要、方法有新东西、对实践有参考价值；综述和重磅实证优先，纯增量小改靠后。",
            "只输出 JSON 数组，6 个元素，按推荐度排序，不要任何额外文字：",
            '[{"id":"论文id","headline":"≤18字中文看点标题","reason":"≤60字中文推荐理由","audience":"适合谁，≤12字"}]',
            "id 必须来自候选列表，禁止编造。"
          ].join("\n")
        },
        { role: "user", content: `候选论文（最近提交）：\n${JSON.stringify(candidates)}` }
      ],
      max_tokens: 1200,
      temperature: 0.3
    },
    { timeoutMs: 90000 }
  );

  const body = await res.json();
  const text = body.choices?.[0]?.message?.content || "";
  const picks = extractJson(text);
  const byId = new Map(pool.map((paper) => [paper.id, paper]));
  const items = picks
    .filter((pick) => pick && byId.has(pick.id))
    .slice(0, 6)
    .map((pick) => ({
      paper: byId.get(pick.id),
      headline: String(pick.headline || "").slice(0, 40),
      reason: String(pick.reason || "").slice(0, 160),
      audience: String(pick.audience || "").slice(0, 30)
    }));
  if (!items.length) throw new Error("empty_picks");

  const payload = { expires: Date.now() + FEATURED_TTL_MS, generatedAt: new Date().toISOString(), picks: items };
  await mkdir(config.storageDir, { recursive: true });
  await writeFile(FEATURED_FILE, JSON.stringify(payload), "utf8").catch(() => {});
  return payload;
}
