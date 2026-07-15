// 乔木 arXiv 前端：history 路由 + vanilla 渲染 + SSE 流式 AI
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

// ---------- 工具 ----------

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add("show"));
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => (toastEl.hidden = true), 200);
  }, 1800);
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.message) message = body.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

function paperUrl(id) {
  return `/paper/${encodeURIComponent(id)}`;
}

function idChip(id, { button = true } = {}) {
  const tag = button ? "button" : "span";
  const attrs = button ? `type="button" data-copy-id="${esc(id)}" title="点击复制"` : "";
  return `<${tag} class="id-chip" ${attrs}>${esc(id)}</${tag}>`;
}

function catTag(cat) {
  return cat ? `<a class="cat-tag" href="/search?q=${encodeURIComponent(cat)}&cat=${encodeURIComponent(cat)}" data-link>${esc(cat)}</a>` : "";
}

function authorsLine(paper) {
  const names = paper.authors.join("、");
  const more = paper.authorsMore ? ` 等 ${paper.authors.length + paper.authorsMore} 人` : "";
  return `${esc(names)}${more ? esc(more) : ""}`;
}

// 极简 Markdown：先转义，再处理标题/粗体/列表/行内代码/段落
function renderMarkdown(src) {
  const lines = esc(src).replace(/\r/g, "").split("\n");
  const out = [];
  let listType = null;
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const inline = (text) =>
    text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="text-link" href="$2" target="_blank" rel="noopener">$1</a>');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // 空行不立即断列表：下一行若仍是同类列表项则保持连续编号
      const next = lines.slice(i + 1).find((l) => l.trim());
      const nextIsList = next && (/^[-*]\s+/.test(next.trim()) || /^\d+[.、]\s+/.test(next.trim()));
      if (!nextIsList) closeList();
      continue;
    }
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) { closeList(); out.push(`<h3>${inline(heading[1])}</h3>`); continue; }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\d+[.、]\s*(.+)$/);
    if (numbered) {
      if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

// SSE over fetch（POST 流式）
async function streamSse(url, body, handlers) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const json = await res.json();
      if (json.message) message = json.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "delta") handlers.onDelta?.(event.text);
        else if (event.type === "done") handlers.onDone?.(event);
        else if (event.type === "error") handlers.onError?.(event.error);
      } catch { /* ignore malformed */ }
    }
  }
}

// ---------- 收藏（localStorage） ----------

const FAV_KEY = "qiaomu-arxiv:favorites";

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}

function isFavorite(id) {
  return getFavorites().some((fav) => fav.id === id);
}

function toggleFavorite(paper) {
  const favs = getFavorites();
  const index = favs.findIndex((fav) => fav.id === paper.id);
  if (index >= 0) {
    favs.splice(index, 1);
    showToast("已取消收藏");
  } else {
    favs.unshift({ id: paper.id, title: paper.title, addedAt: Date.now() });
    showToast("已收藏");
  }
  localStorage.setItem(FAV_KEY, JSON.stringify(favs.slice(0, 200)));
  return index < 0;
}

// ---------- 通用片段 ----------

function pageLoading() {
  app.innerHTML = '<div class="page-loading" aria-label="加载中"><span></span><span></span><span></span></div>';
}

function renderError(message, retry) {
  app.innerHTML = `
    <div class="error-state">
      <p class="big">出了点问题</p>
      <p>${esc(message)}</p>
      ${retry ? '<button class="btn" type="button" id="retryBtn">重试</button>' : '<a class="btn" href="/" data-link>回首页</a>'}
    </div>`;
  document.getElementById("retryBtn")?.addEventListener("click", retry);
}

function skeletonRows(count = 5) {
  return `<div class="paper-list">${Array.from({ length: count })
    .map(
      () => `<div class="paper-row">
        <div>
          <div class="skeleton" style="width:60%;height:20px;margin-bottom:10px"></div>
          <div class="skeleton" style="width:35%;margin-bottom:10px"></div>
          <div class="skeleton" style="width:90%"></div>
        </div>
      </div>`
    )
    .join("")}</div>`;
}

function paperRow(paper, index = 0, { bilingual = false } = {}) {
  const titleHtml =
    bilingual && paper.titleZh
      ? `<h3 class="paper-title">${esc(paper.titleZh)}</h3><p class="paper-title-en">${esc(paper.title)}</p>`
      : `<h3 class="paper-title">${esc(paper.title)}</h3>`;
  return `
    <div class="paper-row" style="animation-delay:${Math.min(index, 10) * 45}ms">
      <div>
        <a href="${paperUrl(paper.id)}" data-link>${titleHtml}</a>
        <p class="authors">${authorsLine(paper)}</p>
        <p class="summary">${esc(paper.summary)}</p>
        ${paper.comment ? `<p class="comment">备注：${esc(paper.comment)}</p>` : ""}
        <div class="row-meta">
          ${idChip(paper.id)}
          ${catTag(paper.primaryCategory)}
          <span class="date-text">${fmtDate(paper.published)}</span>
        </div>
      </div>
      <div class="row-actions">
        <a class="btn btn-sm" href="https://arxiv.org/pdf/${esc(paper.id)}" target="_blank" rel="noopener" title="下载 PDF">PDF</a>
        <a class="btn btn-sm" href="${paperUrl(paper.id)}" data-link>详情</a>
      </div>
    </div>`;
}

function renderPaperList(papers, { start = 0, hasMore = false, onMore = null, listId = "paperList" } = {}) {
  if (!papers.length && start === 0) {
    return `<div class="empty-state">
      <p class="big">没有找到匹配的论文</p>
      <p>换个关键词试试，或者用英文术语搜索；也可以从首页的主题策展里逛逛。</p>
      <a class="btn" href="/topics" data-link>浏览主题</a>
    </div>`;
  }
  return `
    <div class="paper-list" id="${listId}">
      ${papers.map((paper, i) => paperRow(paper, start + i)).join("")}
    </div>
    ${hasMore ? `<div class="load-more-wrap"><button class="btn" type="button" id="loadMoreBtn">加载更多</button></div>` : ""}`;
}

function wireLoadMore(onMore) {
  const btn = document.getElementById("loadMoreBtn");
  if (!btn || !onMore) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "加载中…";
    try {
      await onMore();
    } catch (error) {
      showToast(error.message);
      btn.disabled = false;
      btn.textContent = "加载更多";
    }
  });
}

function appendRows(listId, papers, start) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.insertAdjacentHTML("beforeend", papers.map((paper, i) => paperRow(paper, start + i)).join(""));
}

// ---------- 首页 ----------

function featuredCard(pick, index, isLead) {
  const paper = pick.paper;
  const headline = pick.headline || (isLead ? "" : "");
  return `
    <article class="featured-card ${isLead ? "lead" : ""}" style="animation-delay:${index * 60}ms">
      ${headline ? `<p class="pick-headline">${esc(headline)}</p>` : ""}
      <a class="paper-title-link" href="${paperUrl(paper.id)}" data-link>
        <h3 class="paper-title">${esc(paper.title)}</h3>
      </a>
      ${pick.reason ? `<p class="pick-reason">${esc(pick.reason)}</p>` : `<p class="pick-reason">${esc(paper.summary)}</p>`}
      <div class="pick-meta">
        ${idChip(paper.id)}
        ${catTag(paper.primaryCategory)}
        <span class="date-text">${fmtDate(paper.published)}</span>
        ${pick.audience ? `<span class="date-text">适合：${esc(pick.audience)}</span>` : ""}
      </div>
    </article>`;
}

async function renderHome() {
  document.title = "乔木 arXiv — AI 精选论文，中文解读，一键读原文";
  pageLoading();
  try {
    const [featured, topicsData, latest] = await Promise.all([
      api("/api/featured"),
      api("/api/topics"),
      api("/api/latest?max=10")
    ]);

    const picks = featured.picks || [];
    const today = new Date();
    const dateText = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

    app.innerHTML = `
      <section class="home-hero">
        <div>
          <h1 class="hero-title">每天从 arXiv 里<br>挑出<span class="accent">值得读的</span>论文</h1>
          <p class="hero-sub">AI 每日精选 + 主题策展 + 全文搜索，中文解读、一键下载 PDF 与在线阅读，给中文研究者的 arXiv 入口。</p>
        </div>
        <div class="hero-meta">
          <div class="date mono">${dateText}</div>
          <div>${featured.ai ? "今日精选由 DeepSeek 从最新提交中挑出" : "精选生成中，先按时间展示最新提交"}</div>
        </div>
      </section>

      <section class="section" aria-label="今日精选">
        <div class="section-head">
          <h2>今日精选</h2>
          <span class="note">${featured.ai ? "AI 推荐理由 · 每日更新" : "最新提交 · AI 推荐生成中"}</span>
        </div>
        <div class="featured-grid">
          ${picks.map((pick, i) => featuredCard(pick, i, i === 0)).join("")}
        </div>
      </section>

      <section class="section" aria-label="精选主题">
        <div class="section-head">
          <h2>主题策展</h2>
          <span class="note">按研究方向追踪最新进展</span>
        </div>
        <div class="topic-grid">
          ${topicsData.topics
            .map(
              (topic, i) => `
            <a class="topic-card" href="/topic/${esc(topic.id)}" data-link style="animation-delay:${i * 40}ms">
              <h3>${esc(topic.name)}</h3>
              <p>${esc(topic.tagline)}</p>
              <span class="arrow">查看论文 →</span>
            </a>`
            )
            .join("")}
        </div>
      </section>

      <section class="section" aria-label="最新提交">
        <div class="section-head">
          <h2>最新提交</h2>
          <a class="note text-link" href="/topic/llm-agents" data-link>看 LLM 智能体专题 →</a>
        </div>
        ${renderPaperList(latest.papers, { hasMore: false })}
      </section>`;
  } catch (error) {
    renderError(error.message, renderHome);
  }
}

// ---------- 搜索页 ----------

function readSearchParams() {
  const params = new URLSearchParams(location.search);
  return {
    q: params.get("q") || "",
    cat: params.get("cat") || "",
    sort: params.get("sort") || "relevance",
    start: Number(params.get("start") || 0)
  };
}

async function renderSearch() {
  const state = readSearchParams();
  document.title = state.q ? `搜索：${state.q} · 乔木 arXiv` : "搜索论文 · 乔木 arXiv";
  pageLoading();

  let topicsData;
  try {
    topicsData = await api("/api/topics");
  } catch (error) {
    renderError(error.message, renderSearch);
    return;
  }

  const filtersHtml = `
    <form class="search-form-big" id="searchForm" role="search">
      <input type="search" name="q" value="${esc(state.q)}" placeholder="关键词 / 作者 / arXiv ID（如 2607.11881）" autofocus aria-label="搜索论文">
      <button class="btn btn-primary" type="submit">搜索</button>
    </form>
    <div class="filter-bar">
      ${topicsData.categoryFilters
        .map(
          (cat) =>
            `<button type="button" class="chip ${state.cat === cat.id ? "active" : ""}" data-cat="${esc(cat.id)}">${esc(cat.name)}</button>`
        )
        .join("")}
      <span class="chip-divider"></span>
      <span class="sort-group">
        <button type="button" class="chip ${state.sort === "relevance" ? "active" : ""}" data-sort="relevance">相关度</button>
        <button type="button" class="chip ${state.sort === "date" ? "active" : ""}" data-sort="date">最新</button>
      </span>
    </div>`;

  const arxivIdMatch = state.q.trim().match(/^(?:arxiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i);
  if (arxivIdMatch) {
    app.innerHTML = `<div class="search-page-head">${filtersHtml}</div>${skeletonRows(1)}`;
    location.replace(paperUrl(arxivIdMatch[1] + (arxivIdMatch[2] || "")));
    return;
  }

  if (!state.q) {
    app.innerHTML = `
      <div class="search-page-head">${filtersHtml}</div>
      <div class="empty-state">
        <p class="big">输入关键词开始搜索</p>
        <p>支持标题、摘要、作者检索；也可以直接输入 arXiv ID 跳转到论文。英文术语召回更好。</p>
      </div>`;
    wireSearchForm(state);
    return;
  }

  app.innerHTML = `<div class="search-page-head">${filtersHtml}</div>${skeletonRows()}`;
  wireSearchForm(state);

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(state.q)}&cat=${encodeURIComponent(state.cat)}&sort=${state.sort}&start=${state.start}`);
    const head = document.querySelector(".search-page-head");
    head.insertAdjacentHTML(
      "beforeend",
      `<p class="result-count" style="margin-top:16px">找到 <strong class="mono">${data.total.toLocaleString()}</strong> 篇结果${state.cat ? `（${esc(state.cat)}）` : ""}</p>`
    );
    const listHtml = renderPaperList(data.papers, {
      start: data.start,
      hasMore: data.hasMore,
      onMore: async () => {
        const next = await api(
          `/api/search?q=${encodeURIComponent(state.q)}&cat=${encodeURIComponent(state.cat)}&sort=${state.sort}&start=${data.start + data.papers.length}`
        );
        appendRows("paperList", next.papers, next.start);
        const btnWrap = document.querySelector(".load-more-wrap");
        if (!next.hasMore) btnWrap?.remove();
        else {
          const btn = document.getElementById("loadMoreBtn");
          btn.disabled = false;
          btn.textContent = "加载更多";
          data.papers = data.papers.concat(next.papers);
        }
      }
    });
    document.querySelector(".paper-list")?.remove();
    app.insertAdjacentHTML("beforeend", listHtml);
    wireLoadMore();
  } catch (error) {
    renderError(error.message, renderSearch);
  }
}

function wireSearchForm(state) {
  document.getElementById("searchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q")?.toString().trim() || "";
    navigate(`/search?q=${encodeURIComponent(q)}&cat=${encodeURIComponent(state.cat)}&sort=${state.sort}`);
  });
  document.querySelectorAll("[data-cat]").forEach((chip) => {
    chip.addEventListener("click", () => {
      navigate(
        `/search?q=${encodeURIComponent(state.q)}&cat=${encodeURIComponent(chip.dataset.cat)}&sort=${state.sort}`
      );
    });
  });
  document.querySelectorAll("[data-sort]").forEach((chip) => {
    chip.addEventListener("click", () => {
      navigate(
        `/search?q=${encodeURIComponent(state.q)}&cat=${encodeURIComponent(state.cat)}&sort=${chip.dataset.sort}`
      );
    });
  });
}

// ---------- 主题列表 / 主题详情 ----------

async function renderTopics() {
  document.title = "主题策展 · 乔木 arXiv";
  pageLoading();
  try {
    const { topics } = await api("/api/topics");
    app.innerHTML = `
      <div class="topic-head">
        <h1>主题策展</h1>
        <p>人工挑选的研究方向，每个主题背后是精心调过的 arXiv 检索式，按最新提交排序。</p>
      </div>
      <div class="topic-grid">
        ${topics
          .map(
            (topic, i) => `
          <a class="topic-card" href="/topic/${esc(topic.id)}" data-link style="animation-delay:${i * 40}ms">
            <h3>${esc(topic.name)}</h3>
            <p>${esc(topic.tagline)}</p>
            <span class="arrow">查看论文 →</span>
          </a>`
          )
          .join("")}
      </div>`;
  } catch (error) {
    renderError(error.message, renderTopics);
  }
}

async function renderTopicDetail(topicId) {
  pageLoading();
  try {
    const data = await api(`/api/topic/${encodeURIComponent(topicId)}`);
    document.title = `${data.topic.name} · 主题策展 · 乔木 arXiv`;
    app.innerHTML = `
      <div class="topic-head">
        <a class="back-link" href="/topics" data-link>← 全部主题</a>
        <h1>${esc(data.topic.name)}</h1>
        <p>${esc(data.topic.tagline)} · 共 <span class="mono">${data.total.toLocaleString()}</span> 篇相关论文</p>
      </div>
      ${renderPaperList(data.papers, { start: data.start, hasMore: data.hasMore })}`;
    wireLoadMore(async () => {
      const next = await api(`/api/topic/${encodeURIComponent(topicId)}?start=${data.start + data.papers.length}`);
      appendRows("paperList", next.papers, next.start);
      if (!next.hasMore) document.querySelector(".load-more-wrap")?.remove();
      else {
        const btn = document.getElementById("loadMoreBtn");
        btn.disabled = false;
        btn.textContent = "加载更多";
        data.papers = data.papers.concat(next.papers);
      }
    });
  } catch (error) {
    if (error.message.includes("404") || error.message.includes("topic")) {
      renderError("这个主题不存在。", null);
    } else {
      renderError(error.message, () => renderTopicDetail(topicId));
    }
  }
}

// ---------- 论文详情 ----------

async function renderPaper(id) {
  pageLoading();
  let paper;
  try {
    ({ paper } = await api(`/api/paper/${encodeURIComponent(id)}`));
  } catch (error) {
    renderError(error.message, () => renderPaper(id));
    return;
  }

  document.title = `${paper.title} · 乔木 arXiv`;
  const fav = isFavorite(paper.id);
  const doiLink = paper.doi
    ? `<a class="btn btn-sm" href="https://doi.org/${esc(paper.doi)}" target="_blank" rel="noopener">DOI</a>`
    : "";

  app.innerHTML = `
    <article class="paper-head">
      <a class="back-link" href="/" data-link data-back>← 返回</a>
      <h1>${esc(paper.title)}</h1>
      <p class="authors">${esc(paper.authors.join("、"))}</p>
      <div class="paper-meta-row">
        ${idChip(paper.id)}
        ${paper.categories.map(catTag).join("")}
        <span class="date-text">提交 ${fmtDate(paper.published)}</span>
        ${paper.updated && fmtDate(paper.updated) !== fmtDate(paper.published) ? `<span class="date-text">更新 ${fmtDate(paper.updated)}</span>` : ""}
        ${paper.version ? `<span class="date-text">${esc(paper.version)}</span>` : ""}
      </div>
      <div class="paper-actions">
        <a class="btn btn-primary" href="${esc(paper.links.pdf)}" target="_blank" rel="noopener">下载 PDF</a>
        <a class="btn" href="${esc(paper.links.abs)}" target="_blank" rel="noopener">arXiv 页面</a>
        <a class="btn" href="${esc(paper.links.html)}" target="_blank" rel="noopener">HTML 全文</a>
        ${doiLink}
        <button class="btn fav-btn ${fav ? "active" : ""}" type="button" id="favBtn">${fav ? "★ 已收藏" : "☆ 收藏"}</button>
      </div>
    </article>

    <div class="paper-body">
      <div class="abstract-block">
        <h2>摘要</h2>
        <p class="abstract-text">${esc(paper.summary)}</p>
        ${paper.comment || paper.journalRef ? `
        <dl class="extra">
          ${paper.comment ? `<div><dt>作者备注：</dt><dd>${esc(paper.comment)}</dd></div>` : ""}
          ${paper.journalRef ? `<div><dt>发表信息：</dt><dd>${esc(paper.journalRef)}</dd></div>` : ""}
        </dl>` : ""}
        <div class="chat-block" id="chatBlock">
          <h2 style="font-size:18px">就这篇论文提问</h2>
          <div class="chat-messages" id="chatMessages"></div>
          <form class="chat-form" id="chatForm">
            <input type="text" name="q" placeholder="例如：这篇和 RAG 有什么关系？" aria-label="提问" autocomplete="off">
            <button class="btn btn-primary btn-sm" type="submit">发送</button>
          </form>
        </div>
      </div>

      <aside class="ai-panel" aria-label="AI 解读">
        <div class="ai-panel-head">
          <span class="spark">✦</span>
          <h2>AI 解读</h2>
        </div>
        <p class="hint">由 DeepSeek 基于摘要生成的中文解读，细节以原文为准</p>
        <button class="btn btn-primary" type="button" id="explainBtn">生成解读</button>
        <div class="ai-content" id="aiContent"></div>
      </aside>
    </div>`;

  document.getElementById("favBtn").addEventListener("click", (event) => {
    const nowFav = toggleFavorite({ id: paper.id, title: paper.title });
    event.currentTarget.classList.toggle("active", nowFav);
    event.currentTarget.textContent = nowFav ? "★ 已收藏" : "☆ 收藏";
  });

  const explainBtn = document.getElementById("explainBtn");
  const aiContent = document.getElementById("aiContent");
  let explainText = "";

  explainBtn.addEventListener("click", async () => {
    explainBtn.disabled = true;
    explainBtn.textContent = "解读中…";
    aiContent.classList.add("ai-caret");
    explainText = "";
    try {
      await streamSse(`/api/paper/${encodeURIComponent(paper.id)}/explain`, null, {
        onDelta(text) {
          explainText += text;
          aiContent.innerHTML = renderMarkdown(explainText);
        },
        onDone() {
          aiContent.classList.remove("ai-caret");
          explainBtn.textContent = "重新生成";
          explainBtn.disabled = false;
        },
        onError(message) {
          aiContent.classList.remove("ai-caret");
          aiContent.innerHTML = `<p class="hint">${esc(message)}</p>`;
          explainBtn.textContent = "重试";
          explainBtn.disabled = false;
        }
      });
    } catch (error) {
      aiContent.classList.remove("ai-caret");
      aiContent.innerHTML = `<p class="hint">${esc(error.message)}</p>`;
      explainBtn.textContent = "重试";
      explainBtn.disabled = false;
    }
  });

  // 追问对话
  const chatForm = document.getElementById("chatForm");
  const chatMessages = document.getElementById("chatMessages");
  const turns = [];

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = chatForm.elements.q;
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    turns.push({ role: "user", content: question });
    chatMessages.insertAdjacentHTML("beforeend", `<div class="chat-msg user">${esc(question)}</div>`);
    const answerEl = document.createElement("div");
    answerEl.className = "chat-msg assistant ai-caret";
    chatMessages.appendChild(answerEl);
    let answerText = "";
    const submitBtn = chatForm.querySelector("button");
    submitBtn.disabled = true;
    try {
      await streamSse(`/api/paper/${encodeURIComponent(paper.id)}/chat`, { messages: turns }, {
        onDelta(text) {
          answerText += text;
          answerEl.innerHTML = renderMarkdown(answerText);
        },
        onDone() {
          answerEl.classList.remove("ai-caret");
          turns.push({ role: "assistant", content: answerText });
          submitBtn.disabled = false;
        },
        onError(message) {
          answerEl.classList.remove("ai-caret");
          answerEl.innerHTML = esc(message);
          turns.pop();
          submitBtn.disabled = false;
        }
      });
    } catch (error) {
      answerEl.classList.remove("ai-caret");
      answerEl.innerHTML = esc(error.message);
      turns.pop();
      submitBtn.disabled = false;
    }
  });
}

// ---------- 经典论文 ----------

async function renderClassics() {
  document.title = "经典论文 50 篇 · AI 发展史上的里程碑 · 乔木 arXiv";
  pageLoading();
  try {
    const { classics } = await api("/api/classics");
    const byYear = new Map();
    for (const item of classics) {
      if (!byYear.has(item.year)) byYear.set(item.year, []);
      byYear.get(item.year).push(item);
    }
    const years = [...byYear.keys()].sort();

    app.innerHTML = `
      <div class="topic-head">
        <h1>经典论文 50 篇</h1>
        <p>AI 发展史上的里程碑，从 word2vec 到推理大模型。标题与简介双语对照，由 DeepSeek 编译。</p>
      </div>
      <div class="classics-timeline">
        ${years
          .map(
            (year) => `
          <section class="classics-year">
            <div class="year-marker mono">${esc(year)}</div>
            <div class="year-papers">
              ${byYear
                .get(year)
                .map(
                  (item) => `
                <div class="classic-row">
                  <span class="classic-rank mono">${String(item.rank).padStart(2, "0")}</span>
                  <div class="classic-main">
                    <div class="classic-titles">
                      <a href="${paperUrl(item.id)}" data-link><h3 class="classic-title-en">${esc(item.title)}</h3></a>
                      ${item.titleZh ? `<p class="classic-title-zh">${esc(item.titleZh)}</p>` : ""}
                    </div>
                    ${item.introZh ? `<p class="classic-intro-zh">${esc(item.introZh)}</p>` : ""}
                    ${item.introEn ? `<p class="classic-intro-en">${esc(item.introEn)}</p>` : ""}
                    <div class="row-meta">
                      ${idChip(item.id)}
                      ${catTag(item.primaryCategory)}
                      <span class="cat-tag">${esc(item.tag)}</span>
                    </div>
                  </div>
                  <div class="row-actions">
                    <a class="btn btn-sm" href="https://arxiv.org/pdf/${esc(item.id)}" target="_blank" rel="noopener" title="下载 PDF">PDF</a>
                    <a class="btn btn-sm" href="${paperUrl(item.id)}" data-link>详情</a>
                  </div>
                </div>`
                )
                .join("")}
            </div>
          </section>`
          )
          .join("")}
      </div>`;
  } catch (error) {
    renderError(error.message, renderClassics);
  }
}

// ---------- 搜索下载 ----------

let suggestionTimer = null;

function stopSuggestionTimer() {
  if (suggestionTimer) {
    clearInterval(suggestionTimer);
    suggestionTimer = null;
  }
}

async function renderDiscover() {
  document.title = "搜索下载 · 用人话找论文 · 乔木 arXiv";
  stopSuggestionTimer();
  const prefill = new URLSearchParams(location.search).get("q") || "";

  app.innerHTML = `
    <div class="discover-hero">
      <h1 class="discover-title">用人话找论文</h1>
      <p class="discover-sub">描述你想了解的方向，AI 理解你的意图后检索最合适的论文，标题自动翻译成中文。</p>
      <form class="discover-form" id="discoverForm" role="search">
        <input type="search" name="q" value="${esc(prefill)}" placeholder="例如：我想搞懂大模型是怎么学会推理的" autofocus aria-label="描述你想找的论文">
        <button class="btn btn-primary" type="submit">搜索下载</button>
      </form>
      <div class="suggestion-rotate" id="suggestionRotate" hidden>
        <span class="suggestion-prefix">试试：</span><button type="button" class="suggestion-text" id="suggestionText"></button>
      </div>
      <div class="suggestion-chips" id="suggestionChips"></div>
    </div>
    <div id="discoverResults"></div>`;

  const resultsEl = document.getElementById("discoverResults");
  const form = document.getElementById("discoverForm");
  const input = form.elements.q;

  async function runDiscover(q) {
    const question = q.trim();
    if (!question) return;
    if (location.pathname !== "/discover" || new URLSearchParams(location.search).get("q") !== question) {
      history.replaceState({}, "", `/discover?q=${encodeURIComponent(question)}`);
    }
    stopSuggestionTimer();
    const rotateEl = document.getElementById("suggestionRotate");
    if (rotateEl) rotateEl.hidden = true;
    resultsEl.innerHTML = `<p class="discover-thinking">AI 正在理解你的问题并检索 arXiv…</p>${skeletonRows(4)}`;
    try {
      const data = await api("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question })
      });
      const termsLine = data.terms
        .map((t) => `<span class="cat-tag">${esc(t)}</span>`)
        .join("");
      resultsEl.innerHTML = `
        <div class="discover-plan">
          ${data.note ? `<p class="plan-note">${esc(data.note)}</p>` : ""}
          <div class="plan-terms">${termsLine}${data.cat ? `<span class="cat-tag">${esc(data.cat)}</span>` : ""}<span class="result-count" style="margin:0">找到 <strong class="mono">${data.total.toLocaleString()}</strong> 篇</span></div>
        </div>
        ${
          data.papers.length
            ? `<div class="paper-list">${data.papers.map((p, i) => paperRow(p, i, { bilingual: true })).join("")}</div>`
            : `<div class="empty-state"><p class="big">没有检索到结果</p><p>换个说法试试，比如加上更具体的方向或方法名。</p></div>`
        }`;
    } catch (error) {
      resultsEl.innerHTML = `<div class="error-state"><p class="big">检索失败</p><p>${esc(error.message)}</p></div>`;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runDiscover(input.value);
  });

  // 轮播搜索词：每 5 秒换一条，点击自动搜索
  try {
    const { suggestions } = await api("/api/discover/suggestions");
    const rotateEl = document.getElementById("suggestionRotate");
    const textBtn = document.getElementById("suggestionText");
    const chipsEl = document.getElementById("suggestionChips");
    let cursor = Math.floor(Math.random() * suggestions.length);

    const show = () => {
      textBtn.textContent = suggestions[cursor % suggestions.length];
      textBtn.classList.remove("swap");
      requestAnimationFrame(() => textBtn.classList.add("swap"));
    };
    rotateEl.hidden = false;
    show();
    textBtn.addEventListener("click", () => {
      input.value = textBtn.textContent;
      runDiscover(textBtn.textContent);
    });
    rotateEl.addEventListener("mouseenter", stopSuggestionTimer);
    suggestionTimer = setInterval(() => {
      cursor += 1;
      show();
    }, 5000);

    // 静态快捷 chips（取前 6 条，不与轮播当前项重复也没关系）
    chipsEl.innerHTML = suggestions
      .slice(0, 6)
      .map((s) => `<button type="button" class="chip" data-suggestion="${esc(s)}">${esc(s)}</button>`)
      .join("");
    chipsEl.querySelectorAll("[data-suggestion]").forEach((chip) => {
      chip.addEventListener("click", () => {
        input.value = chip.dataset.suggestion;
        runDiscover(chip.dataset.suggestion);
      });
    });
  } catch {
    // 建议词加载失败不影响搜索
  }

  if (prefill) runDiscover(prefill);
}

// ---------- 收藏页 ----------

async function renderFavorites() {
  document.title = "我的收藏 · 乔木 arXiv";
  const favs = getFavorites();
  if (!favs.length) {
    app.innerHTML = `
      <div class="empty-state">
        <p class="big">还没有收藏</p>
        <p>在论文详情页点「收藏」，论文会存在这个浏览器里，随时回来继续读。</p>
        <a class="btn btn-primary" href="/" data-link>去看今日精选</a>
      </div>`;
    return;
  }
  pageLoading();
  const papers = [];
  for (const fav of favs) {
    try {
      const { paper } = await api(`/api/paper/${encodeURIComponent(fav.id)}`);
      papers.push(paper);
    } catch {
      papers.push({ id: fav.id, title: fav.title, summary: "", authors: [], primaryCategory: "", published: "" });
    }
  }
  app.innerHTML = `
    <div class="topic-head">
      <h1>我的收藏</h1>
      <p>共 ${papers.length} 篇 · 仅保存在当前浏览器</p>
    </div>
    ${renderPaperList(papers)}`;
}

// ---------- 路由 ----------

const routes = [
  { pattern: /^\/$/, render: renderHome, nav: "home" },
  { pattern: /^\/topics\/?$/, render: renderTopics, nav: "topics" },
  { pattern: /^\/topic\/([\w-]+)\/?$/, render: (m) => renderTopicDetail(m[1]), nav: "topics" },
  { pattern: /^\/classics\/?$/, render: renderClassics, nav: "classics" },
  { pattern: /^\/discover\/?$/, render: renderDiscover, nav: "discover" },
  { pattern: /^\/search\/?$/, render: renderSearch, nav: null },
  { pattern: /^\/paper\/(.+?)\/?$/, render: (m) => renderPaper(decodeURIComponent(m[1])), nav: null },
  { pattern: /^\/favorites\/?$/, render: renderFavorites, nav: "favorites" }
];

function route() {
  stopSuggestionTimer();
  const path = location.pathname;
  for (const r of routes) {
    const match = path.match(r.pattern);
    if (match) {
      document.querySelectorAll("[data-nav]").forEach((el) => {
        el.classList.toggle("active", el.dataset.nav === r.nav);
      });
      r.render(match);
      return;
    }
  }
  app.innerHTML = `
    <div class="empty-state">
      <p class="big">404 · 页面不存在</p>
      <p>这个地址没有对应内容，回首页继续看论文吧。</p>
      <a class="btn btn-primary" href="/" data-link>回首页</a>
    </div>`;
}

function navigate(url) {
  history.pushState({}, "", url);
  window.scrollTo({ top: 0, behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
  route();
}

// 事件委托：内部链接
document.addEventListener("click", (event) => {
  const backLink = event.target.closest("a[data-back]");
  if (backLink) {
    event.preventDefault();
    const ref = document.referrer;
    if (history.length > 1 && ref && new URL(ref).origin === location.origin) history.back();
    else navigate("/");
    return;
  }
  const link = event.target.closest("a[data-link]");
  if (link) {
    const url = new URL(link.href);
    if (url.origin === location.origin) {
      event.preventDefault();
      if (url.pathname + url.search !== location.pathname + location.search) navigate(url.pathname + url.search);
    }
    return;
  }
  const copyBtn = event.target.closest("[data-copy-id]");
  if (copyBtn) {
    navigator.clipboard?.writeText(copyBtn.dataset.copyId).then(
      () => showToast(`已复制 ${copyBtn.dataset.copyId}`),
      () => showToast("复制失败，请手动选择")
    );
  }
});

// 头部搜索
document.getElementById("headerSearch").addEventListener("submit", (event) => {
  event.preventDefault();
  const q = new FormData(event.currentTarget).get("q")?.toString().trim();
  if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
});

window.addEventListener("popstate", route);

// 头部滚动阴影
const header = document.getElementById("siteHeader");
window.addEventListener(
  "scroll",
  () => header.classList.toggle("scrolled", window.scrollY > 4),
  { passive: true }
);

route();
