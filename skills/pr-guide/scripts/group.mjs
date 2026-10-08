#!/usr/bin/env node
// Ask Claude to group a fetched PR into chapters (used by the GitHub Action;
// in Claude Code the skill does this step itself). Writes DIR/guide.json and
// DIR/run.json (timings and token usage per stage).
//
//   ANTHROPIC_API_KEY=... node group.mjs DIR [options]
//
//   --model M            grouping model (default claude-opus-5-5)
//   --effort E           grouping effort (default medium)
//   --explain-model M    model that writes chapter explanations (default: --model)
//   --explain-effort E   effort for explanations (default low)
//   --mode auto|single|split   one call, or skeleton + parallel chapters (default auto)
//   --speed standard|fast      fast mode, Opus only, Claude API only (default standard)
//   --no-review          skip the review pass on flagged groupings
//
// Pipeline (stage 0, the evidence index, runs in `prguide.mjs fetch`):
//   1. Group. Small PRs: one call returns the whole guide. Larger PRs: one
//      call returns a compact skeleton (titles, one-line gists, hunk ids,
//      summary, flow), which keeps the slow serial part short.
//   2. Check the grouping without a model: unplaced/duplicate hunks, oversized
//      chapters, tests apart from their code, uses before definitions.
//   3. If anything is flagged, one review call fixes it. It re-sends the same
//      prompt prefix, so it reads the PR from the prompt cache.
//   4. Split mode: write every chapter's explanation in parallel, then
//      rewrite any that name identifiers found nowhere in the PR.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_SCHEMA, SKELETON_SCHEMA, checkGuide, needsRepair, ungrounded, prHaystack } from "./lib/guide.mjs";
import { chapterView, prHeader } from "./lib/diff.mjs";
import { buildEvidence } from "./lib/evidence.mjs";

// Below this many prompt tokens (about 4 characters each), one call that also
// writes the explanations beats the extra round trip of the split pipeline.
const SINGLE_CALL_MAX_TOKENS = 20_000;

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args.splice(i, 2)[1];
}
function has(name) {
  const i = args.indexOf(name);
  return i !== -1 && args.splice(i, 1).length > 0;
}
const model = opt("--model", "claude-opus-5-5");
const effort = opt("--effort", "medium");
const explainModel = opt("--explain-model", model);
const explainEffort = opt("--explain-effort", "low");
const modeArg = opt("--mode", "auto");
const speed = opt("--speed", "standard");
const review = !has("--no-review");
const dir = resolve(args[0] || ".");

const here = dirname(fileURLToPath(import.meta.url));
const grouping = readFileSync(join(here, "..", "GROUPING.md"), "utf8");
const writing = readFileSync(join(here, "..", "WRITING.md"), "utf8");
const prText = readFileSync(join(dir, "for-model.txt"), "utf8");
const pr = JSON.parse(readFileSync(join(dir, "pr.json"), "utf8"));
const files = JSON.parse(readFileSync(join(dir, "hunks.json"), "utf8"));
const evidence = buildEvidence(files);
const haystack = prHaystack(pr, files);

const mode = modeArg === "auto" ? (prText.length / 4 <= SINGLE_CALL_MAX_TOKENS ? "single" : "split") : modeArg;
const client = new Anthropic();
const run = { mode, model, effort, explainModel, explainEffort, speed, stages: [], warnings: [] };
const t0 = performance.now();

class StopError extends Error {}

// One streamed request. Fast mode can't be paired with server-side fallbacks
// (the fallback model must accept the same request), so a fast request that
// is refused or rate limited is retried once at standard speed.
async function call(stage, { model, effort, system, content, schema, maxTokens = 64000 }, fast = speed === "fast" && model.includes("opus")) {
  const started = performance.now();
  const body = {
    model,
    max_tokens: maxTokens,
    betas: fast ? ["fast-mode-2026-02-01"] : ["server-side-fallback-2026-07-01"],
    ...(fast ? { speed: "fast" } : { fallbacks: "default" }),
    output_config: { effort, ...(schema && { format: { type: "json_schema", schema } }) },
    system,
    messages: [{ role: "user", content }],
  };
  let message;
  try {
    message = await client.beta.messages.stream(body).finalMessage();
  } catch (err) {
    if (fast && err instanceof Anthropic.RateLimitError) return call(stage, { model, effort, system, content, schema, maxTokens }, false);
    throw err;
  }
  if (message.stop_reason === "refusal" && fast) return call(stage, { model, effort, system, content, schema, maxTokens }, false);
  if (message.stop_reason === "refusal") throw new StopError(`the model declined this PR (${message.stop_details?.category ?? "no category"}).`);
  if (message.stop_reason === "max_tokens") throw new StopError(`the ${stage} response hit max_tokens before it was complete.`);

  const u = message.usage;
  run.stages.push({
    stage, model: message.model, ms: Math.round(performance.now() - started), speed: fast ? "fast" : "standard",
    input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens,
  });
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// The grouping prompt. The PR text is the cached prefix shared by the
// grouping call and the review call; anything that differs between them
// comes after it.
function groupingContent(extra) {
  return [
    { type: "text", text: `Write the review guide for this pull request.\n\n${prText}`, cache_control: { type: "ephemeral" } },
    ...(extra ? [{ type: "text", text: extra }] : []),
  ];
}

async function group() {
  const schema = mode === "single" ? GUIDE_SCHEMA : SKELETON_SCHEMA;
  // Single mode writes explanations too, so it also gets WRITING.md.
  const system = mode === "single" ? `${grouping}\n\n${writing}` : grouping;
  const draft = JSON.parse(await call("group", { model, effort, system, content: groupingContent(), schema }));
  const problems = checkGuide(draft, files, evidence);
  run.flags = problems.map((p) => p.kind);
  if (!problems.length || !review) return draft;

  const note = [
    "Here is a draft of the guide:",
    "```json", JSON.stringify(draft), "```",
    "A script checked it and found:",
    ...problems.map((p) => `- ${p.message}`),
    "",
    "Return the complete guide, corrected. Missing, unknown and repeated hunks must be fixed. The other findings are heuristics: fix the ones that are real and keep the grouping where it is right.",
  ].join("\n");
  const revised = JSON.parse(await call("review", { model, effort, system, content: groupingContent(note), schema }));
  const after = checkGuide(revised, files, evidence);
  run.flagsAfterReview = after.map((p) => p.kind);
  // Keep the revision unless it made the structure worse.
  if (needsRepair(after) && !needsRepair(problems)) {
    run.warnings.push("The review pass broke hunk coverage; kept the first draft.");
    return draft;
  }
  return revised;
}

async function explain(guide, i, retryNote) {
  const c = guide.chapters[i];
  const outline = guide.chapters.map((x, j) => `${j + 1}. ${x.title}: ${x.gist ?? ""}${j === i ? "   <- this chapter" : ""}`).join("\n");
  const text = [
    prHeader(pr),
    "",
    "## The guide",
    guide.summary,
    "",
    outline,
    "",
    `## Chapter ${i + 1}: ${c.title}`,
    chapterView(files, c.hunks),
    "",
    `Write the explanation for chapter ${i + 1}. Reply with the explanation text only.`,
    retryNote || "",
  ].join("\n");
  return (await call(`explain ${i + 1}`, { model: explainModel, effort: explainEffort, system: writing, content: text, maxTokens: 16000 })).trim();
}

async function explainAll(guide) {
  const settle = (i, note) => explain(guide, i, note).catch((err) => {
    if (err instanceof StopError || err instanceof Anthropic.APIError) {
      run.warnings.push(`Chapter ${i + 1}: explanation failed (${err.message}); used the one-line gist.`);
      return guide.chapters[i].gist;
    }
    throw err;
  });
  const texts = await Promise.all(guide.chapters.map((_, i) => settle(i)));
  await fixUngrounded(guide, texts, (i, note) => settle(i, note));
  guide.chapters = guide.chapters.map((c, i) => ({ title: c.title, explanation: texts[i], hunks: c.hunks }));
}

// Rewrite (in parallel) the explanations that name things the PR doesn't contain.
async function fixUngrounded(guide, texts, rewrite) {
  const bad = texts.map((t, i) => [i, ungrounded(t, haystack)]).filter(([, names]) => names.length);
  run.ungrounded = bad.map(([i, names]) => ({ chapter: i + 1, names }));
  await Promise.all(bad.map(async ([i, names]) => {
    const note = `A draft of this explanation named ${names.map((n) => `\`${n}\``).join(", ")}, which appear nowhere in the PR. Use only names that appear in the hunks or the PR text.`;
    texts[i] = await rewrite(i, note);
    const left = ungrounded(texts[i], haystack);
    if (left.length) run.warnings.push(`Chapter ${i + 1} explanation names ${left.join(", ")}, which do not appear in the PR.`);
  }));
}

try {
  const guide = await group();
  run.groupedMs = Math.round(performance.now() - t0);
  if (mode === "split") await explainAll(guide);
  else {
    const texts = guide.chapters.map((c) => c.explanation);
    await fixUngrounded(guide, texts, (i, note) => explain({ ...guide, chapters: guide.chapters.map((c) => ({ ...c, gist: c.explanation })) }, i, note));
    guide.chapters.forEach((c, i) => (c.explanation = texts[i]));
  }
  run.totalMs = Math.round(performance.now() - t0);
  writeFileSync(join(dir, "guide.json"), JSON.stringify(guide, null, 2));
  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2));

  const sum = (k) => run.stages.reduce((a, s) => a + s[k], 0);
  console.log(`guide.json written: ${guide.chapters.length} chapters, ${mode} mode, ${(run.totalMs / 1000).toFixed(1)}s (grouped in ${(run.groupedMs / 1000).toFixed(1)}s)`);
  console.log(`${run.stages.length} calls: ${sum("input")} in (${sum("cacheRead")} cached) / ${sum("output")} out tokens`);
  if (run.flags?.length) console.log(`review flags: ${run.flags.join(", ")}${run.flagsAfterReview ? ` -> after review: ${run.flagsAfterReview.join(", ") || "none"}` : ""}`);
  for (const w of run.warnings) console.log(`warning: ${w}`);
} catch (err) {
  if (err instanceof StopError) console.error(`pr-guide: ${err.message}`);
  else if (err instanceof Anthropic.RateLimitError) console.error("pr-guide: rate limited by the Claude API; re-run the job later.");
  else if (err instanceof Anthropic.AuthenticationError) console.error("pr-guide: the ANTHROPIC_API_KEY secret is missing or invalid.");
  else if (err instanceof Anthropic.APIError) console.error(`pr-guide: Claude API error ${err.status}: ${err.message}`);
  else console.error(`pr-guide: ${err.message}`);
  process.exit(1);
}
