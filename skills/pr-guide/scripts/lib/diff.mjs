// Parse a unified diff (as printed by `gh pr diff`) into files and hunks.
// Every hunk gets a stable id like "f3h2" (file 3, hunk 2). Files with no
// textual hunks (binary, pure rename, mode change) get one empty hunk so
// they can still be assigned to a chapter.

const GENERATED = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|Podfile\.lock|go\.sum|flake\.lock)$/,
  /\.min\.(js|css)$/,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /\.(pb|generated)\.\w+$/,
];

export function isGenerated(path) {
  return GENERATED.some((re) => re.test(path));
}

function unquote(p) {
  if (p.startsWith('"') && p.endsWith('"')) p = JSON.parse(p);
  return p.replace(/^[ab]\//, "");
}

export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let o = 0;
  let n = 0;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/);
      file = {
        index: files.length + 1,
        oldPath: m ? unquote(m[1]) : null,
        path: m ? unquote(m[2]) : line.slice(11),
        status: "modified",
        binary: false,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename from ")) { file.status = "renamed"; file.oldPath = line.slice(12); }
      else if (line.startsWith("rename to ")) file.path = line.slice(10);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("--- ")) { const p = line.slice(4); if (p !== "/dev/null") file.oldPath = unquote(p); }
      else if (line.startsWith("+++ ")) { const p = line.slice(4); if (p !== "/dev/null") file.path = unquote(p); }
    }

    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
    if (h) {
      o = +h[1];
      n = +h[3];
      hunk = {
        id: `f${file.index}h${file.hunks.length + 1}`,
        path: file.path,
        oldStart: o,
        newStart: n,
        context: h[5] || "",
        lines: [],
        adds: 0,
        dels: 0,
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const t = line[0];
    if (t === "+") { hunk.lines.push({ t, s: line.slice(1), n: n++ }); hunk.adds++; }
    else if (t === "-") { hunk.lines.push({ t, s: line.slice(1), o: o++ }); hunk.dels++; }
    else if (t === " ") hunk.lines.push({ t, s: line.slice(1), o: o++, n: n++ });
    else if (t === "\\") continue; // "\ No newline at end of file"
    else if (line === "" && i === lines.length - 1) continue;
    else if (line === "") hunk.lines.push({ t: " ", s: "", o: o++, n: n++ });
  }

  for (const f of files) {
    f.generated = isGenerated(f.path);
    if (f.hunks.length === 0) {
      const what = f.binary ? "binary file" : f.status === "renamed" ? `renamed from ${f.oldPath}` : f.status;
      f.hunks.push({ id: `f${f.index}h1`, path: f.path, oldStart: 0, newStart: 0, context: `(${what}, no text diff)`, lines: [], adds: 0, dels: 0 });
    }
    f.adds = f.hunks.reduce((a, h) => a + h.adds, 0);
    f.dels = f.hunks.reduce((a, h) => a + h.dels, 0);
    for (const h of f.hunks) h.generated = f.generated;
  }
  return files;
}

export function allHunks(files) {
  return files.flatMap((f) => f.hunks);
}

// One hunk as text, clipped to `maxLines` with the clipping stated inline so
// the model knows it is looking at a partial body. Deletion-only hunks are
// clipped harder: what was removed matters less than what was added.
function hunkText(h, maxLines) {
  const out = [`=== ${h.id} ${h.path} ===`, `@@ -${h.oldStart} +${h.newStart} @@ ${h.context}`];
  const body = h.lines.map((l) => l.t + l.s);
  const limit = h.adds === 0 && maxLines < 400 ? Math.min(maxLines, 10) : maxLines;
  if (body.length > limit) {
    out.push(...body.slice(0, limit), `[... ${body.length - limit} more lines in this hunk not shown]`);
  } else out.push(...body);
  return out.join("\n");
}

// Commit bodies carry intent, which helps separate concerns, so they are
// included (trimmed), not just the headlines.
function commitLines(pr) {
  return (pr.commits || []).map((c) => {
    const body = (c.messageBody || "").trim();
    if (!body) return `- ${c.messageHeadline}`;
    const short = body.length > 500 ? body.slice(0, 500) + " [...]" : body;
    return `- ${c.messageHeadline}\n${short.replace(/^/gm, "  ")}`;
  });
}

export function prHeader(pr) {
  return [
    `PR #${pr.number}: ${pr.title}`,
    `Author: ${pr.author?.login ?? "unknown"}   Base: ${pr.baseRefName}   Head: ${pr.headRefName}`,
    `Size: +${pr.additions} -${pr.deletions} across ${pr.changedFiles} files`,
    "",
    "## Description",
    (pr.body || "(no description)").trim(),
    "",
    "## Commits",
    ...commitLines(pr),
  ].join("\n");
}

// A compact text view of the PR for the model that groups hunks into
// chapters. Long hunks are clipped so the whole PR fits.
export function modelView(pr, files, { budgetChars = 600_000, evidence = "" } = {}) {
  const header = [
    prHeader(pr),
    "",
    "## Hunks",
    "Each hunk starts with a line `=== <hunk id> <path> ===`. Generated files (lockfiles, snapshots) are listed but not shown; they are assigned automatically.",
    "",
  ].join("\n");
  const tail = evidence ? `\n${evidence}\n` : "";

  for (const maxLines of [400, 150, 60, 25, 10, 0]) {
    const parts = [header];
    for (const f of files) {
      const status = f.status === "renamed" ? `renamed from ${f.oldPath}` : f.status;
      parts.push(`# FILE ${f.path} (${status}, +${f.adds} -${f.dels})${f.generated ? " [generated, skipped]" : ""}`);
      if (f.generated) continue;
      for (const h of f.hunks) parts.push(hunkText(h, maxLines));
      parts.push("");
    }
    const text = parts.join("\n") + tail;
    if (text.length <= budgetChars || maxLines === 0) return text;
  }
}

// The hunks of one chapter, in the chapter's reading order, for the call
// that writes that chapter's explanation.
export function chapterView(files, ids, { budgetChars = 120_000 } = {}) {
  const byId = new Map(allHunks(files).map((h) => [h.id, h]));
  const hunks = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const maxLines of [400, 150, 60, 25, 10]) {
    const text = hunks.map((h) => hunkText(h, maxLines)).join("\n\n");
    if (text.length <= budgetChars || maxLines === 10) return text;
  }
}
