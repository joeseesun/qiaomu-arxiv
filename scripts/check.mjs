// 零依赖检查：所有 JS/MJS 文件语法检查 + 关键文件存在性
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listFiles(dir, ext, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "storage") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const required = [
  "package.json",
  "server/index.mjs",
  "server/arxiv.mjs",
  "server/ai.mjs",
  "server/config.mjs",
  "server/topics.mjs",
  "server/seo.mjs",
  "public/index.html",
  "public/app.js",
  "public/styles.css"
];

let failed = false;

for (const file of required) {
  if (!existsSync(path.join(rootDir, file))) {
    console.error(`✗ 缺少文件: ${file}`);
    failed = true;
  }
}

const scripts = [
  ...(await listFiles(path.join(rootDir, "server"), ".mjs")),
  ...(await listFiles(path.join(rootDir, "scripts"), ".mjs"))
];

for (const file of scripts) {
  try {
    await execFileAsync(process.execPath, ["--check", file]);
    console.log(`✓ ${path.relative(rootDir, file)}`);
  } catch (error) {
    console.error(`✗ ${path.relative(rootDir, file)}\n${error.stderr || error.message}`);
    failed = true;
  }
}

// 前端 JS 语法检查（按 ESM 解析）
const appJs = path.join(rootDir, "public", "app.js");
try {
  const source = await readFile(appJs, "utf8");
  new Function(source.replace(/^import .*$/gm, "").replace(/export /g, ""));
  console.log("✓ public/app.js");
} catch (error) {
  console.error(`✗ public/app.js\n${error.message}`);
  failed = true;
}

// 服务端模块可导入性
for (const mod of ["config", "topics", "arxiv", "ai"]) {
  try {
    await import(pathToFileURL(path.join(rootDir, "server", `${mod}.mjs`)));
    console.log(`✓ import server/${mod}.mjs`);
  } catch (error) {
    console.error(`✗ import server/${mod}.mjs: ${error.message}`);
    failed = true;
  }
}

if (failed) {
  console.error("\n检查未通过");
  process.exit(1);
}
console.log("\n全部检查通过");
