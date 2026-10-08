#!/usr/bin/env node
// pr-guide CLI. No dependencies beyond Node 18+ and the GitHub CLI (`gh`).
//
//   prguide.mjs fetch <pr> [--out DIR]        download the PR and split it into hunks
//   prguide.mjs schema                        print the JSON schema guide.json must follow
//   prguide.mjs render DIR [--guide-url URL]  validate guide.json, write guide.html + comment.md
//   prguide.mjs comment DIR [--guide-url URL] create or update the PR comment from comment.md
//                                             (--guide-url rewrites comment.md with that link first)
//
// <pr> is a PR number (current repo), a PR URL, or owner/repo#123.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseDiff, modelView, allHunks } from "./lib/diff.mjs";
import { GUIDE_SCHEMA, finalizeGuide, checkGuide, ungrounded, prHaystack } from "./lib/guide.mjs";
import { buildEvidence, evidenceText } from "./lib/evidence.mjs";
import { renderComment, COMMENT_MARKER } from "./lib/markdown.mjs";
import { renderHtml } from "./lib/html.mjs";

const PR_FIELDS = "number,title,body,url,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,commits";

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
}

function prArgs(ref) {
  const m = ref.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  return m ? [m[2], "--repo", m[1]] : [ref];
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function fetchCmd(args) {
  const out = flag(args, "--out");
  const ref = args[0];
  if (!ref) throw new Error("usage: prguide.mjs fetch <pr> [--out DIR]");

  const pr = JSON.parse(gh(["pr", "view", ...prArgs(ref), "--json", PR_FIELDS]));
  const diff = gh(["pr", "diff", ...prArgs(ref)]);
  const files = parseDiff(diff);
  const repo = pr.url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+$/, "");
  const dir = resolve(out || join(tmpdir(), "pr-guide", `${repo.replace("/", "-")}-${pr.number}`));
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "pr.json"), JSON.stringify(pr, null, 2));
  writeFileSync(join(dir, "diff.patch"), diff);
  writeFileSync(join(dir, "hunks.json"), JSON.stringify(files));
  const ev = buildEvidence(files);
  writeFileSync(join(dir, "for-model.txt"), modelView(pr, files, { evidence: evidenceText(ev) }));

  const hunks = allHunks(files);
  console.log(`PR #${pr.number}: ${pr.title}`);
  console.log(`${files.length} files, ${hunks.length} hunks (${hunks.filter((h) => h.generated).length} generated), +${pr.additions} -${pr.deletions}`);
  console.log(`evidence: ${ev.links.length} cross-hunk name links, ${ev.testPairs.length} test/source pairs`);
  console.log(`dir: ${dir}`);
  console.log(`read: ${join(dir, "for-model.txt")}`);
  console.log(`write: ${join(dir, "guide.json")}`);
}

function renderCmd(args) {
  const guideUrl = flag(args, "--guide-url");
  const dir = resolve(args[0] || ".");
  const pr = readJson(join(dir, "pr.json"));
  const files = readJson(join(dir, "hunks.json"));
  const guidePath = join(dir, "guide.json");
  if (!existsSync(guidePath)) throw new Error(`missing ${guidePath}; write it first (see \`prguide.mjs schema\`)`);

  const raw = readJson(guidePath);
  const flags = checkGuide(raw, files, buildEvidence(files)).filter((p) => !["unknown", "duplicate", "unplaced"].includes(p.kind));
  const haystack = prHaystack(pr, files);
  for (const [i, c] of (raw.chapters || []).entries()) {
    const names = ungrounded(c.explanation || "", haystack);
    if (names.length) flags.push({ kind: "ungrounded", message: `Chapter ${i + 1} explanation names ${names.map((n) => `\`${n}\``).join(", ")}, which appear nowhere in the PR.` });
  }
  const { guide, warnings } = finalizeGuide(raw, files);
  writeFileSync(join(dir, "guide.final.json"), JSON.stringify(guide, null, 2));
  writeFileSync(join(dir, "guide.html"), renderHtml(pr, guide, files));
  writeFileSync(join(dir, "comment.md"), renderComment(pr, guide, files, { guideUrl }));

  console.log(`${guide.chapters.length} chapters:`);
  guide.chapters.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2, "0")} ${c.title}  (${c.hunks.length} hunks, +${c.adds} -${c.dels})`));
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  } else console.log("\nEvery hunk is covered exactly once.");
  if (flags.length) {
    console.log(`\n${flags.length} review flag(s) (heuristics; fix the real ones):`);
    for (const f of flags) console.log(`  - [${f.kind}] ${f.message}`);
  }
  console.log(`\nhtml: ${join(dir, "guide.html")}\ncomment: ${join(dir, "comment.md")}`);
}

function commentCmd(args) {
  const guideUrl = flag(args, "--guide-url");
  const dir = resolve(args[0] || ".");
  const pr = readJson(join(dir, "pr.json"));
  // The Action only knows the guide's URL after uploading it, which is after render.
  if (guideUrl) writeFileSync(join(dir, "comment.md"), renderComment(pr, readJson(join(dir, "guide.final.json")), readJson(join(dir, "hunks.json")), { guideUrl }));
  const body = readFileSync(join(dir, "comment.md"), "utf8");
  const [, repo, number] = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);

  const comments = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments`])).flat();
  const existing = comments.find((c) => c.body?.startsWith(COMMENT_MARKER));
  const payload = JSON.stringify({ body });
  if (existing) {
    gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "--input", "-"], { input: payload });
    console.log(`updated ${existing.html_url}`);
  } else {
    const created = JSON.parse(gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "--input", "-"], { input: payload }));
    console.log(`created ${created.html_url}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "fetch") fetchCmd(rest);
  else if (cmd === "render") renderCmd(rest);
  else if (cmd === "comment") commentCmd(rest);
  else if (cmd === "schema") console.log(JSON.stringify(GUIDE_SCHEMA, null, 2));
  else {
    console.error("usage: prguide.mjs fetch|schema|render|comment ...");
    process.exit(2);
  }
} catch (err) {
  console.error(`prguide: ${err.message}`);
  process.exit(1);
}
