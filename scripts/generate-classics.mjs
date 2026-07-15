// 生成经典论文双语数据：node scripts/generate-classics.mjs
// 读 classics-seed.json（自带规范英文标题）→ DeepSeek 生成双语标题与简介
// → 写 server/data/classics.json（提交进仓库，运行时静态读取）
// 设计说明：元数据不依赖 arXiv API（限流严格且生成只需一次），标题人工校准过。
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = await readFile(path.join(rootDir, envFile), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // 文件不存在则跳过
  }
}

const { aiEnabled } = await import("../server/ai.mjs");
const { config } = await import("../server/config.mjs");

if (!aiEnabled()) {
  console.error("未配置 DEEPSEEK_API_KEY");
  process.exit(1);
}

const seed = JSON.parse(await readFile(path.join(rootDir, "server/data/classics-seed.json"), "utf8"));
if (seed.length !== 50) {
  console.error(`种子应为 50 篇，实际 ${seed.length} 篇`);
  process.exit(1);
}
const yearOf = (id) => `20${id.slice(0, 2)}`;
console.log(`种子 ${seed.length} 篇，调用 DeepSeek 生成双语数据…`);

const input = seed.map((s) => ({ id: s.id, title: s.title, tag: s.tag, year: yearOf(s.id) }));

const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.deepseekApiKey}`
  },
  body: JSON.stringify({
    model: config.deepseekModel,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "system",
        content: [
          "你是 AI 学术史编辑，为中文读者编写「AI 经典论文 50 篇」的双语条目。",
          "输入是论文的 arXiv id、英文标题、主题标签与年份，这些都是 AI 发展史上公认的里程碑论文，按你的知识作答即可。",
          "对每篇论文输出：",
          "- title_zh：中文标题，忠实原意，≤24字，术语保留英文原词（如 Transformer、GAN）；",
          "- intro_zh：中文简介 1-2 句，≤80字，说清这篇论文提出了什么、为什么在历史上重要；",
          "- intro_en：对应的英文简介，≤45 words，与中文意思一致。",
          "只输出 JSON 数组，不要任何额外文字。id 原样回传。"
        ].join("\n")
      },
      { role: "user", content: JSON.stringify(input) }
    ],
    max_tokens: 8000,
    temperature: 0.3
  }),
  signal: AbortSignal.timeout(180000)
});

if (!res.ok) {
  console.error(`DeepSeek 请求失败: ${res.status}`, (await res.text()).slice(0, 300));
  process.exit(1);
}
const body = await res.json();
const text = body.choices?.[0]?.message?.content || "";
const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
const raw = fence ? fence[1] : text;
const items = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const bilingual = new Map(items.map((item) => [item.id, item]));

const classics = seed.map((s, index) => {
  const bi = bilingual.get(s.id) || {};
  return {
    rank: index + 1,
    id: s.id,
    tag: s.tag,
    title: s.title,
    titleZh: bi.title_zh || "",
    year: yearOf(s.id),
    introZh: bi.intro_zh || "",
    introEn: bi.intro_en || ""
  };
});

const outFile = path.join(rootDir, "server/data/classics.json");
await writeFile(outFile, JSON.stringify(classics, null, 2), "utf8");
const noZh = classics.filter((c) => !c.titleZh || !c.introZh || !c.introEn).map((c) => c.id);
console.log(`已写入 ${outFile}，共 ${classics.length} 篇。缺失双语：${noZh.length ? noZh.join(", ") : "无"}`);
