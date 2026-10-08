import { mermaidFlow } from "./guide.mjs";

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Produces a single self-contained page (no <html>/<head>/<body>, which the
// Artifact publisher adds; browsers opening the file locally don't need them).
export function renderHtml(pr, guide, files) {
  const repo = (pr.url || "").replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");
  const data = {
    pr: {
      number: pr.number, title: pr.title, url: pr.url, repo,
      author: pr.author?.login || "", base: pr.baseRefName, head: pr.headRefName,
      sha: pr.headRefOid || "", additions: pr.additions, deletions: pr.deletions,
    },
    guide,
    files: files.map((f) => ({
      path: f.path, oldPath: f.oldPath, status: f.status, adds: f.adds, dels: f.dels,
      hunks: f.hunks.map((h) => ({ id: h.id, context: h.context, lines: h.lines })),
    })),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = pr.title.length > 70 ? pr.title.slice(0, 67) + "…" : pr.title;
  const flow = mermaidFlow(guide.flow);

  return `<meta charset="utf-8">
<title>${escHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
/* Layout: reading column on the left, code on the right; one chapter at a time. */
:root {
  --bg: #f6f7f9; --surface: #ffffff; --ink: #1b2130; --muted: #687184; --line: #e2e5eb;
  --accent: #3150c4; --accent-soft: #e9edfb;
  --add-bg: #e7f4eb; --add-fg: #1c7139; --add-bar: #2f8a50;
  --del-bg: #fbe9e8; --del-fg: #b3261e;
  --sans: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #12151b; --surface: #1a1e27; --ink: #e5e8ee; --muted: #98a1b1; --line: #2a303c;
  --accent: #8ea3ff; --accent-soft: #232b48;
  --add-bg: #15301f; --add-fg: #79d495; --add-bar: #3fae66;
  --del-bg: #3a1c1c; --del-fg: #ff8f86; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #12151b; --surface: #1a1e27; --ink: #e5e8ee; --muted: #98a1b1; --line: #2a303c;
  --accent: #8ea3ff; --accent-soft: #232b48;
  --add-bg: #15301f; --add-fg: #79d495; --add-bar: #3fae66;
  --del-bg: #3a1c1c; --del-fg: #ff8f86; color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 15px/1.6 var(--sans); }
.wrap { max-width: 1280px; margin: 0 auto; padding-inline: clamp(16px, 4vw, 40px); padding-block: 28px 64px; }
a { color: var(--accent); }
code, .mono { font-family: var(--mono); font-size: .88em; }
p code, li code { background: var(--accent-soft); padding: .05em .35em; border-radius: 4px; }
h1, h2 { text-wrap: balance; letter-spacing: -.01em; }
.eyebrow { font: 500 12px/1 var(--mono); color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
.eyebrow a { color: inherit; text-decoration: none; }
.eyebrow a:hover { color: var(--accent); }
header h1 { font-size: clamp(22px, 3vw, 30px); line-height: 1.25; margin: 10px 0 12px; font-weight: 600; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.plus { color: var(--add-fg); } .minus { color: var(--del-fg); }

nav.tabs { display: flex; gap: 4px; margin: 24px 0 28px; border-bottom: 1px solid var(--line); }
nav.tabs button { font: 500 14px var(--sans); color: var(--muted); background: none; border: 0; padding: 10px 14px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
nav.tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); }
nav.tabs button:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.overview { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 40px; align-items: start; margin-bottom: 28px; }
.overview h2 { font-size: 20px; margin: 0 0 10px; }
.overview ol { padding-left: 1.3em; margin: 0; display: grid; gap: 6px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.flow { padding: 18px 20px; }
.flow h3 { margin: 0; font-size: 16px; font-weight: 600; }
.flow .caption { color: var(--muted); font-size: 14px; margin: 2px 0 10px; }
.flow .diagram { overflow-x: auto; }
.flow pre.mermaid { margin: 0; text-align: center; background: none; font-family: var(--mono); font-size: 12px; color: var(--muted); }
.legend { display: flex; gap: 16px; color: var(--muted); font-size: 12px; margin-top: 8px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; background: var(--add-bg); border: 1px solid var(--add-bar); }

.toc { margin-top: 36px; }
.toc h2 { font-size: 16px; margin: 0 0 10px; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li button { width: 100%; display: grid; grid-template-columns: 2.5em minmax(0, 1fr) auto auto; gap: 16px; align-items: baseline; text-align: left; font: inherit; color: inherit; background: none; border: 0; border-top: 1px solid var(--line); padding: 12px 4px; cursor: pointer; }
.toc li button:hover .t { color: var(--accent); }
.toc .n { font-family: var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.toc .f { color: var(--muted); font-size: 13px; }
.toc .d { font: 13px var(--mono); font-variant-numeric: tabular-nums; min-width: 7em; text-align: right; }
.note { color: var(--muted); font-size: 13px; margin: 14px 0 0; max-width: 70ch; }
.toc .done .t { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--muted); }

.chapter { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.5fr); gap: 32px; align-items: start; }
/* Sticky, but never taller than the window: a long chapter scrolls inside the
   sidebar, so its buttons stay reachable while the code column scrolls. */
.chapter aside { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 16px); max-height: calc(100vh - 32px); overflow-y: auto; overscroll-behavior: contain; }
.chapter aside h2 { font-size: 24px; line-height: 1.25; margin: 0 0 8px; font-weight: 600; }
/* One dot per chapter: filled = reviewed, ringed = current. */
.dots { display: flex; flex-wrap: wrap; gap: 2px; margin: 0 0 10px -6px; }
.dot { width: 22px; height: 22px; padding: 0; border: 0; background: none; cursor: pointer; display: grid; place-items: center; border-radius: 50%; }
.dot::after { content: ""; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--muted); box-sizing: border-box; }
.dot.done::after { background: var(--accent); border-color: var(--accent); }
.dot.current::after { width: 11px; height: 11px; border: 2px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.dot.current.done::after { background: var(--accent); }
.dot:hover::after { border-color: var(--accent); }
.chapter aside h2 { margin-bottom: 16px; }
.explain p { margin: 0 0 12px; max-width: 62ch; }
.explain ul { margin: 0 0 12px; padding-left: 1.2em; max-width: 62ch; display: grid; gap: 6px; }
.flist { list-style: none; padding: 0; margin: 20px 0 0; display: grid; gap: 8px; font-size: 14px; }
.flist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
.flist button { font: inherit; text-align: left; background: none; border: 0; padding: 0; color: var(--ink); cursor: pointer; overflow-wrap: anywhere; }
.flist button:hover { color: var(--accent); }
.flist .dir { color: var(--muted); font-size: 13px; }
.flist .d { font: 13px var(--mono); }
.pager { display: flex; gap: 8px; margin-top: 24px; flex-wrap: wrap; }
.pager button { font: 500 13px var(--sans); color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 7px 12px; cursor: pointer; }
.pager button:disabled { opacity: .4; cursor: default; }
.pager button.primary { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.undo { display: block; margin-top: 10px; font: 13px var(--sans); color: var(--muted); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.undo:hover { color: var(--accent); }

.files { display: grid; gap: 16px; min-width: 0; }
.file { overflow: hidden; }
.file > header { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.file > header .p { font: 500 14px var(--mono); overflow-wrap: anywhere; }
.file > header .s { font-size: 12px; color: var(--muted); }
.file > header .d { margin-left: auto; font: 13px var(--mono); }
.chip { font: 500 11px var(--mono); color: var(--accent); background: var(--accent-soft); border-radius: 4px; padding: 1px 6px; border: 0; cursor: pointer; }
.code { overflow-x: auto; }
table.diff { border-collapse: collapse; width: 100%; font: 12.5px/1.65 var(--mono); }
table.diff td { padding: 0 10px; white-space: pre; vertical-align: top; }
table.diff td.ln { color: var(--muted); text-align: right; width: 1%; user-select: none; font-variant-numeric: tabular-nums; opacity: .8; }
table.diff td.sg { width: 1%; padding: 0 4px; user-select: none; }
table.diff tr.a { background: var(--add-bg); } table.diff tr.a td.sg, table.diff tr.a td.ln { color: var(--add-fg); }
table.diff tr.d { background: var(--del-bg); } table.diff tr.d td.sg, table.diff tr.d td.ln { color: var(--del-fg); }
table.diff tr.h td { color: var(--muted); background: var(--bg); padding-block: 4px; font-size: 12px; }
.empty { padding: 14px 16px; color: var(--muted); font-size: 13px; }

@media (max-width: 860px) {
  .overview, .chapter { grid-template-columns: minmax(0, 1fr); }
  .chapter aside { position: static; max-height: none; overflow: visible; }
  .toc li button { grid-template-columns: 2.2em minmax(0, 1fr) auto; }
  .toc .f { display: none; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>

<div class="wrap">
  <header>
    <div class="eyebrow"><a id="repo-link" href="${escHtml(pr.url)}">${escHtml(repo)} · #${pr.number}</a></div>
    <h1>${escHtml(pr.title)}</h1>
    <div class="meta" id="meta"></div>
  </header>

  <nav class="tabs" role="tablist">
    <button role="tab" id="tab-overview" data-tab="overview" aria-selected="true">Overview</button>
    <button role="tab" id="tab-guide" data-tab="guide" aria-selected="false">Guide</button>
    <button role="tab" id="tab-diff" data-tab="diff" aria-selected="false">Diff</button>
  </nav>

  <section id="panel-overview" role="tabpanel">
    <div class="overview">
      <div>
        <h2>Overview</h2>
        <div class="explain" id="summary"></div>
      </div>
      <div>
        <h2>How it works</h2>
        <ol id="steps"></ol>
      </div>
    </div>
    ${flow ? `<div class="card flow">
      <h3>Before / after</h3>
      <div class="caption">${escHtml(guide.flow.caption)}</div>
      <div class="diagram"><pre class="mermaid">${escHtml(flow)}</pre></div>
      <div class="legend"><span><i></i>Added or changed in this PR</span><span>Number = chapter that introduces it</span></div>
    </div>` : ""}
    <div class="toc"><h2>Chapters</h2><ol id="toc"></ol>
      <p class="note">The guide explains intent and points at what to check. It is not a review: code it doesn't mention isn't verified.</p></div>
  </section>

  <section id="panel-guide" role="tabpanel" hidden>
    <div class="chapter">
      <aside>
        <div class="dots" id="ch-dots" aria-label="Chapters"></div>
        <h2 id="ch-title"></h2>
        <div class="explain" id="ch-explain"></div>
        <ul class="flist" id="ch-files"></ul>
        <div class="pager">
          <button id="prev" title="Previous chapter (← or k)">Previous</button><button id="mark" class="primary"></button>
        </div>
        <button class="undo" id="undo" hidden>Mark as not reviewed</button>
      </aside>
      <div class="files" id="ch-code"></div>
    </div>
  </section>

  <section id="panel-diff" role="tabpanel" hidden>
    <div class="files" id="all-code"></div>
  </section>
</div>

<script type="application/json" id="data">${json}</script>
<script>
(() => {
  const { pr, guide, files } = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (s) => esc(s).replace(/\`([^\`]+)\`/g, "<code>$1</code>").replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>");
  // Paragraphs separated by blank lines; runs of "- " lines become a list.
  const md = (text) => String(text).trim().split(/\\n\\s*\\n/).map((block) => {
    const out = [];
    let para = [], items = [];
    const flush = () => {
      if (para.length) out.push("<p>" + fmt(para.join(" ")) + "</p>");
      if (items.length) out.push("<ul>" + items.map((i) => "<li>" + fmt(i) + "</li>").join("") + "</ul>");
      para = []; items = [];
    };
    for (const line of block.split("\\n")) {
      const m = line.match(/^\\s*[-*] (.*)$/);
      if (m) { if (para.length) { out.push("<p>" + fmt(para.join(" ")) + "</p>"); para = []; } items.push(m[1]); }
      else if (items.length && /^\\s+\\S/.test(line)) items[items.length - 1] += " " + line.trim();
      else { if (items.length) flush(); para.push(line); }
    }
    flush();
    return out.join("");
  }).join("");
  const inline = (s) => esc(s).replace(/\`([^\`]+)\`/g, "<code>$1</code>");
  const delta = (a, d) => '<span class="plus">+' + a + '</span> <span class="minus">−' + d + "</span>";

  const hunkById = new Map();
  const hunkChapter = new Map();
  files.forEach((f) => f.hunks.forEach((h) => hunkById.set(h.id, { ...h, file: f })));
  guide.chapters.forEach((c, i) => c.hunks.forEach((id) => hunkChapter.set(id, i)));

  // Reviewed state is per viewer and per head commit, so new pushes reset it.
  const KEY = "prguide:" + pr.url + "@" + pr.sha;
  let reviewed = new Set();
  try { reviewed = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
  const saveReviewed = () => { try { localStorage.setItem(KEY, JSON.stringify([...reviewed])); } catch {} };

  $("meta").innerHTML = [
    pr.author && "by " + esc(pr.author),
    '<span class="mono">' + esc(pr.base) + " ← " + esc(pr.head) + "</span>",
    delta(pr.additions, pr.deletions),
    files.length + " files",
    guide.chapters.length + " chapters",
  ].filter(Boolean).map((s) => "<span>" + s + "</span>").join("");

  $("summary").innerHTML = md(guide.summary);
  $("steps").innerHTML = guide.steps.map((s) => "<li>" + inline(s) + "</li>").join("");

  function renderToc() {
    $("toc").innerHTML = guide.chapters.map((c, i) =>
      '<li class="' + (reviewed.has(i) ? "done" : "") + '"><button data-ch="' + i + '">' +
      '<span class="n">' + pad(i + 1) + '</span><span class="t">' + esc(c.title) + "</span>" +
      '<span class="f">' + c.files.length + " file" + (c.files.length === 1 ? "" : "s") + "</span>" +
      '<span class="d">' + delta(c.adds, c.dels) + "</span></button></li>").join("");
  }

  function hunkRows(h) {
    const rows = ['<tr class="h"><td class="ln"></td><td class="ln"></td><td class="sg"></td><td>' +
      esc(h.lines.length ? "@@ " + (h.context || "") : h.context) + "</td></tr>"];
    for (const l of h.lines) {
      const cls = l.t === "+" ? "a" : l.t === "-" ? "d" : "";
      rows.push('<tr class="' + cls + '"><td class="ln">' + (l.o ?? "") + '</td><td class="ln">' + (l.n ?? "") +
        '</td><td class="sg">' + (l.t === " " ? "" : l.t) + "</td><td>" + esc(l.s) + "</td></tr>");
    }
    return rows.join("");
  }

  // Group hunk ids by file (keeping first-seen order) and draw one card per file.
  function fileCards(ids, { chips }) {
    const groups = new Map();
    for (const id of ids) {
      const h = hunkById.get(id);
      if (!groups.has(h.file.path)) groups.set(h.file.path, { file: h.file, hunks: [] });
      groups.get(h.file.path).hunks.push(h);
    }
    return [...groups.values()].map(({ file, hunks }) => {
      const a = hunks.reduce((s, h) => s + h.lines.filter((l) => l.t === "+").length, 0);
      const d = hunks.reduce((s, h) => s + h.lines.filter((l) => l.t === "-").length, 0);
      const status = file.status === "renamed" ? "renamed from " + file.oldPath : file.status === "modified" ? "" : file.status;
      const chs = chips ? [...new Set(hunks.map((h) => hunkChapter.get(h.id)))].map((i) =>
        '<button class="chip" data-ch="' + i + '" title="' + esc(guide.chapters[i].title) + '">Ch ' + pad(i + 1) + "</button>").join(" ") : "";
      const body = hunks.every((h) => !h.lines.length)
        ? '<div class="empty">' + esc(hunks[0].context) + "</div>"
        : '<div class="code"><table class="diff">' + hunks.map(hunkRows).join("") + "</table></div>";
      return '<article class="card file" data-path="' + esc(file.path) + '"><header><span class="p">' + esc(file.path) +
        '</span><span class="s">' + esc(status) + "</span>" + chs + '<span class="d">' + delta(a, d) + "</span></header>" + body + "</article>";
    }).join("");
  }

  let current = 0;
  function showChapter(i) {
    current = Math.max(0, Math.min(guide.chapters.length - 1, i));
    const c = guide.chapters[current];
    $("ch-title").textContent = c.title;
    renderAction();
    $("ch-explain").innerHTML = md(c.explanation);
    $("ch-files").innerHTML = c.files.map((f) => {
      const cut = f.path.lastIndexOf("/");
      return '<li><button data-path="' + esc(f.path) + '">' + esc(f.path.slice(cut + 1)) +
        ' <span class="dir">' + esc(f.path.slice(0, cut + 1)) + '</span></button><span class="d">' + delta(f.adds, f.dels) + "</span></li>";
    }).join("");
    $("ch-code").innerHTML = fileCards(c.hunks, { chips: false });
    $("prev").disabled = current === 0;
  }

  // Dots and the main button. Unreviewed: "Mark reviewed, next" marks the
  // chapter and moves on. Reviewed: the button just moves on.
  function renderAction() {
    const last = current === guide.chapters.length - 1;
    const done = reviewed.has(current);
    $("ch-dots").innerHTML = guide.chapters.map((c, i) =>
      '<button class="dot' + (reviewed.has(i) ? " done" : "") + (i === current ? " current" : "") + '" data-ch="' + i +
      '" title="' + (i + 1) + ". " + esc(c.title) + (reviewed.has(i) ? " (reviewed)" : "") + '"' +
      (i === current ? ' aria-current="step"' : "") + "></button>").join("");
    $("mark").textContent = done ? (last ? "Back to overview" : "Next chapter") : (last ? "Mark reviewed" : "Mark reviewed, next");
    $("mark").title = done ? "" : "Mark this chapter reviewed (→ or j moves on without marking)";
    $("undo").hidden = !done;
  }

  function showTab(tab, { chapter, scroll } = {}) {
    for (const t of ["overview", "guide", "diff"]) {
      $("panel-" + t).hidden = t !== tab;
      $("tab-" + t).setAttribute("aria-selected", String(t === tab));
    }
    if (chapter !== undefined) showChapter(chapter);
    try { history.replaceState(null, "", "#" + (tab === "guide" ? "ch" + (current + 1) : tab)); } catch {}
    if (scroll !== false) window.scrollTo({ top: 0 });
  }

  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) return showTab(tab.dataset.tab);
    const ch = e.target.closest("[data-ch]");
    if (ch) return showTab("guide", { chapter: +ch.dataset.ch });
    const fp = e.target.closest(".flist [data-path]");
    if (fp) document.querySelector('#ch-code [data-path="' + CSS.escape(fp.dataset.path) + '"]')?.scrollIntoView({ block: "start" });
  });
  $("prev").onclick = () => showTab("guide", { chapter: current - 1 });
  $("mark").onclick = () => {
    const last = current === guide.chapters.length - 1;
    if (!reviewed.has(current)) {
      reviewed.add(current);
      saveReviewed();
      renderToc();
      if (last) return renderAction();
    } else if (last) return showTab("overview");
    showTab("guide", { chapter: current + 1 });
  };
  $("undo").onclick = () => {
    reviewed.delete(current);
    saveReviewed();
    renderToc();
    renderAction();
  };
  document.addEventListener("keydown", (e) => {
    if ($("panel-guide").hidden || e.target.matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key === "j" || e.key === "ArrowRight") { e.preventDefault(); showTab("guide", { chapter: current + 1 }); }
    if (e.key === "k" || e.key === "ArrowLeft") { e.preventDefault(); showTab("guide", { chapter: current - 1 }); }
  });

  renderToc();
  showChapter(0);
  $("all-code").innerHTML = fileCards(files.flatMap((f) => f.hunks.map((h) => h.id)), { chips: true });

  const m = location.hash.match(/^#ch(\\d+)$/);
  if (m) showTab("guide", { chapter: +m[1] - 1, scroll: false });
  else if (location.hash === "#diff") showTab("diff", { scroll: false });

  // Artifacts render mermaid blocks natively. When the file is opened
  // anywhere else, load mermaid once and render the diagram ourselves.
  const pre = document.querySelector("pre.mermaid");
  if (pre) setTimeout(() => {
    if (pre.querySelector("svg") || !pre.isConnected) return;
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
    s.onload = () => {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", fontFamily: "IBM Plex Mono, monospace" });
      window.mermaid.run({ nodes: [pre] });
    };
    document.head.appendChild(s);
  }, 1200);
})();
</script>
`;
}
