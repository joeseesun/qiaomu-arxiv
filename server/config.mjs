import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, "..");

// 开发便利：加载 .env.local / .env，已存在的环境变量优先
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(path.join(rootDir, envFile), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // 文件不存在则跳过
  }
}

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

function normalizeBaseUrl(raw) {
  const value = (raw || "https://api.deepseek.com").replace(/\/+$/, "");
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("bad protocol");
    return value;
  } catch {
    throw new Error(`DEEPSEEK_BASE_URL 无效: ${raw}`);
  }
}

export const config = {
  port: Number(process.env.PORT || 4174),
  host: process.env.HOST || "127.0.0.1",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "https://arxiv.qiaomu.ai").replace(/\/+$/, ""),
  storageDir: path.resolve(rootDir, process.env.STORAGE_DIR || "storage"),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekBaseUrl: normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL),
  deepseekModel: DEEPSEEK_MODEL
};

export function runtimeStatus() {
  return {
    ai: Boolean(config.deepseekApiKey),
    deepseekModel: config.deepseekModel,
    storage: config.storageDir,
    publicBaseUrl: config.publicBaseUrl
  };
}
