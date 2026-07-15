// 预热搜索下载的 suggestion 查询缓存：node scripts/warm-discover.mjs [baseUrl]
// 逐条 POST /api/discover，结果落盘缓存 24h，用户点击轮播词即秒出。
// 限速保守：每条间隔 12s；遇 429/504 等 60s 重试一次。
const baseUrl = (process.argv[2] || "http://127.0.0.1:4174").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { suggestions } = await (await fetch(`${baseUrl}/api/discover/suggestions`)).json();
console.log(`共 ${suggestions.length} 条搜索词，目标 ${baseUrl}`);

let ok = 0;
for (const q of suggestions) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
        signal: AbortSignal.timeout(120000)
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`✓ ${q}（${body.papers?.length ?? 0} 篇，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
        ok++;
        break;
      }
      console.log(`✗ ${q} [${res.status}] ${body.message || ""}`);
      if (attempt === 1 && (res.status === 429 || res.status === 503 || res.status === 504)) {
        console.log("  等 60s 重试…");
        await sleep(60000);
        continue;
      }
      break;
    } catch (error) {
      console.log(`✗ ${q} 请求异常: ${error.message}`);
      break;
    }
  }
  await sleep(12000);
}
console.log(`完成：${ok}/${suggestions.length} 条预热成功`);
