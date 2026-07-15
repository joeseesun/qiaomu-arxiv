// 经典论文 50 篇：静态数据（由 scripts/generate-classics.mjs 生成并提交）
import { readFile } from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./config.mjs";

const classicsFile = path.join(rootDir, "server/data/classics.json");
let cache = null;

export async function listClassics() {
  if (!cache) {
    cache = JSON.parse(await readFile(classicsFile, "utf8"));
  }
  return cache;
}
