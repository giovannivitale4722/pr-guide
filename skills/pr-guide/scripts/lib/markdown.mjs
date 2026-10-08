import { createHash } from "node:crypto";
import { mermaidFlow } from "./guide.mjs";

export const COMMENT_MARKER = "<!-- pr-guide -->";

// GitHub anchors each file in the "Files changed" tab as #diff-<sha256(path)>.
function fileLink(pr, path, line) {
  const anchor = createHash("sha256").update(path).digest("hex");
  return `${pr.url}/files#diff-${anchor}${line ? `R${line}` : ""}`;
}

const pad = (n) => String(n).padStart(2, "0");

export function renderComment(pr, guide, files, { guideUrl } = {}) {
  const firstLine = new Map();
  for (const f of files) {
    const h = f.hunks.find((h) => h.lines.some((l) => l.t === "+"));
    firstLine.set(f.path, h ? h.lines.find((l) => l.t === "+").n : 0);
  }

  const out = [COMMENT_MARKER, `## PR guide`, ""];
  out.push(guide.summary, "");
  if (guide.steps.length) out.push(...guide.steps.map((s, i) => `${i + 1}. ${s}`), "");

  const flow = mermaidFlow(guide.flow);
  if (flow) {
    out.push(`**${guide.flow.caption || "How it fits together"}** (green = added in this PR, number = chapter)`, "");
    out.push("```mermaid", flow, "```", "");
  }

  out.push(`### Chapters`, "");
  out.push("| | Chapter | Files | Lines |", "|---|---|---|---|");
  guide.chapters.forEach((c, i) => out.push(`| ${pad(i + 1)} | ${c.title.replace(/\|/g, "\\|")} | ${c.files.length} | +${c.adds} −${c.dels} |`));
  out.push("");

  guide.chapters.forEach((c, i) => {
    out.push(`<details><summary><b>${pad(i + 1)} · ${c.title}</b> &nbsp;(+${c.adds} −${c.dels})</summary>`, "");
    out.push(c.explanation, "");
    for (const f of c.files) out.push(`- [\`${f.path}\`](${fileLink(pr, f.path, firstLine.get(f.path))}) +${f.adds} −${f.dels}`);
    out.push("", "</details>", "");
  });

  out.push("<sub>The guide explains intent and points at what to check. It is not a review: code it doesn't mention isn't verified.</sub>", "");
  const foot = [`Covers all ${files.length} changed files at \`${(pr.headRefOid || "").slice(0, 7)}\`.`];
  if (guideUrl) foot.push(`[Open the interactive guide](${guideUrl})`);
  out.push(`<sub>${foot.join(" · ")}</sub>`);
  return out.join("\n");
}
