// 手动预热每日精选：node scripts/warm-featured.mjs
// 读取 .env.local / .env（若存在），拉取候选池并调用 DeepSeek 生成精选。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = await readFile(path.join(rootDir, envFile), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // 文件不存在则跳过
  }
}

const { recentPool } = await import("../server/arxiv.mjs");
const { generateFeatured, aiEnabled } = await import("../server/ai.mjs");
const { featuredCategories } = await import("../server/topics.mjs");

if (!aiEnabled()) {
  console.error("未配置 DEEPSEEK_API_KEY，无法生成 AI 精选。");
  process.exit(1);
}

console.log("拉取候选论文池…");
const pool = await recentPool(featuredCategories);
console.log(`候选池 ${pool.length} 篇，调用 DeepSeek 挑选…`);
const result = await generateFeatured(pool);
console.log(`已生成 ${result.picks.length} 篇精选，缓存 24 小时。`);
for (const pick of result.picks) {
  console.log(`- [${pick.paper.id}] ${pick.headline || pick.paper.title}`);
}
