#!/usr/bin/env node
// Compare group.mjs configurations on real PRs for quality and speed.
//
//   ANTHROPIC_API_KEY=... node bench.mjs suite.json [--runs 3]
//
// suite.json:
//   {
//     "out": "bench-out",
//     "prs": [{ "ref": "owner/repo#123", "labels": ["labels/123-a.json", "labels/123-b.json"] }],
//     "configs": [
//       { "name": "opus-high-single", "args": ["--effort", "high", "--mode", "single"] },
//       { "name": "opus-medium-split", "args": ["--effort", "medium", "--mode", "split"] }
//     ]
//   }
//
// A label file is a human's chapter split, in guide.json's shape (only
// `chapters[].hunks` is read). Two labelers per PR let the report tell real
// differences from labeler disagreement. Labels are optional; without them
// only the label-free metrics and timings are reported.
//
// Metrics per config (means over PRs, timings as p50/p90 over all runs):
//   ari         agreement with the labels (adjusted Rand index; 0 = chance, 1 = identical)
//   ariFile     the same for one chapter per file, the baseline a config must beat
//   orphans     share of hunks the model left out of every chapter
//   order       chapters that use a name a later chapter defines
//   testsTogether  share of test/source pairs that share a chapter
//   grounded    share of backticked names in explanations that appear in the PR
//   wall, toGrouped  seconds to the finished guide, and to the finished grouping

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allHunks } from "./lib/diff.mjs";
import { buildEvidence } from "./lib/evidence.mjs";
import { checkGuide, prHaystack, ungrounded } from "./lib/guide.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ri = args.indexOf("--runs");
const runs = ri === -1 ? 1 : +args.splice(ri, 2)[1];
const suitePath = resolve(args[0] || "suite.json");
const suite = JSON.parse(readFileSync(suitePath, "utf8"));
const base = dirname(suitePath);
const out = resolve(base, suite.out || "bench-out");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Adjusted Rand index between two labelings of the same items.
function ari(a, b) {
  const n = a.length;
  if (n < 2) return 1;
  const c2 = (x) => (x * (x - 1)) / 2;
  const table = new Map(), ra = new Map(), rb = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${a[i]}\u0000${b[i]}`;
    table.set(k, (table.get(k) || 0) + 1);
    ra.set(a[i], (ra.get(a[i]) || 0) + 1);
    rb.set(b[i], (rb.get(b[i]) || 0) + 1);
  }
  const index = [...table.values()].reduce((s, x) => s + c2(x), 0);
  const sa = [...ra.values()].reduce((s, x) => s + c2(x), 0);
  const sb = [...rb.values()].reduce((s, x) => s + c2(x), 0);
  const expected = (sa * sb) / c2(n);
  const max = (sa + sb) / 2;
  return max === expected ? 1 : (index - expected) / (max - expected);
}

// Chapter index per hunk id; hunks a guide leaves out each get their own group.
function labeling(guide, ids) {
  const of = new Map();
  (guide.chapters || []).forEach((c, i) => (c.hunks || []).forEach((id) => of.has(id) || of.set(id, `c${i}`)));
  return ids.map((id) => of.get(id) ?? `orphan:${id}`);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

function metrics(dir, guide) {
  const pr = readJson(join(dir, "pr.json"));
  const files = readJson(join(dir, "hunks.json"));
  const ev = buildEvidence(files);
  const ids = allHunks(files).filter((h) => !h.generated).map((h) => h.id);
  const placed = new Set((guide.chapters || []).flatMap((c) => c.hunks || []));
  const chapterOf = new Map();
  (guide.chapters || []).forEach((c, i) => (c.hunks || []).forEach((id) => chapterOf.set(id, i)));
  const byPath = (p) => new Set(allHunks(files).filter((h) => h.path === p && chapterOf.has(h.id)).map((h) => chapterOf.get(h.id)));
  const pairs = ev.testPairs.filter((p) => byPath(p.test).size && byPath(p.source).size);
  const together = pairs.filter((p) => [...byPath(p.test)].some((x) => byPath(p.source).has(x))).length;

  const hay = prHaystack(pr, files);
  let names = 0, bad = 0;
  for (const c of guide.chapters || []) {
    names += [...String(c.explanation || "").matchAll(/`([^`\n]+)`/g)].filter((m) => m[1].trim().length >= 3 && !/\s/.test(m[1].trim())).length;
    bad += ungrounded(c.explanation || "", hay).length;
  }
  return {
    ids,
    files,
    orphans: ids.length ? ids.filter((id) => !placed.has(id)).length / ids.length : 0,
    order: checkGuide(guide, files, ev).filter((p) => p.kind === "order").length,
    testsTogether: pairs.length ? together / pairs.length : NaN,
    grounded: names ? 1 - bad / names : NaN,
    chapters: (guide.chapters || []).length,
  };
}

mkdirSync(out, { recursive: true });
const results = [];
for (const item of suite.prs) {
  const prDir = join(out, item.ref.replace(/[^\w.-]+/g, "-"));
  if (!existsSync(join(prDir, "hunks.json"))) {
    execFileSync("node", [join(here, "prguide.mjs"), "fetch", item.ref, "--out", prDir], { stdio: "inherit" });
  }
  const labels = (item.labels || []).map((p) => readJson(resolve(base, p)));

  for (const cfg of suite.configs) {
    for (let r = 0; r < runs; r++) {
      const dir = join(prDir, cfg.name, `run${r + 1}`);
      mkdirSync(dir, { recursive: true });
      for (const f of ["pr.json", "hunks.json", "for-model.txt"]) copyFileSync(join(prDir, f), join(dir, f));
      const started = performance.now();
      let ok = true;
      try {
        execFileSync("node", [join(here, "group.mjs"), dir, ...(cfg.args || [])], { stdio: "inherit" });
      } catch {
        ok = false;
      }
      const wall = (performance.now() - started) / 1000;
      if (!ok) { results.push({ pr: item.ref, config: cfg.name, run: r + 1, failed: true, wall }); continue; }

      const guide = readJson(join(dir, "guide.json"));
      const run = readJson(join(dir, "run.json"));
      const m = metrics(dir, guide);
      const mine = labeling(guide, m.ids);
      const perFile = m.ids.map((id) => allHunks(m.files).find((h) => h.id === id).path);
      const sum = (k) => run.stages.reduce((a, s) => a + s[k], 0);
      results.push({
        pr: item.ref, config: cfg.name, run: r + 1, wall,
        toGrouped: run.groupedMs / 1000,
        aris: labels.map((l) => ari(mine, labeling(l, m.ids))),
        ariFile: mean(labels.map((l) => ari(perFile, labeling(l, m.ids)))),
        interAnnotator: labels.length >= 2 ? ari(labeling(labels[0], m.ids), labeling(labels[1], m.ids)) : NaN,
        orphans: m.orphans, order: m.order, testsTogether: m.testsTogether, grounded: m.grounded, chapters: m.chapters,
        inputTokens: sum("input"), cachedTokens: sum("cacheRead"), outputTokens: sum("output"), calls: run.stages.length,
      });
    }
  }
}
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));

// Summary per config.
const f2 = (x) => (Number.isNaN(x) ? "–" : x.toFixed(2));
const rows = suite.configs.map((cfg) => {
  const rs = results.filter((r) => r.config === cfg.name && !r.failed);
  return {
    name: cfg.name,
    failed: results.filter((r) => r.config === cfg.name && r.failed).length,
    ari: mean(rs.flatMap((r) => r.aris)),
    // How much the score moves with the choice of labeler: differences
    // between configs smaller than this are noise.
    labelerSpread: mean(rs.filter((r) => r.aris.length >= 2).map((r) => Math.abs(r.aris[0] - r.aris[1]))),
    ariFile: mean(rs.map((r) => r.ariFile).filter((x) => !Number.isNaN(x))),
    orphans: mean(rs.map((r) => r.orphans)),
    order: mean(rs.map((r) => r.order)),
    testsTogether: mean(rs.map((r) => r.testsTogether).filter((x) => !Number.isNaN(x))),
    grounded: mean(rs.map((r) => r.grounded).filter((x) => !Number.isNaN(x))),
    wallP50: pct(rs.map((r) => r.wall), 0.5),
    wallP90: pct(rs.map((r) => r.wall), 0.9),
    groupedP50: pct(rs.map((r) => r.toGrouped), 0.5),
    outputTokens: mean(rs.map((r) => r.outputTokens)),
  };
});

const lines = [
  "| config | ARI | per-file ARI | orphans | order flags | tests together | grounded | wall p50 / p90 (s) | grouped p50 (s) | out tokens | failed |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${f2(r.ari)} | ${f2(r.ariFile)} | ${f2(r.orphans)} | ${f2(r.order)} | ${f2(r.testsTogether)} | ${f2(r.grounded)} | ${f2(r.wallP50)} / ${f2(r.wallP90)} | ${f2(r.groupedP50)} | ${Math.round(r.outputTokens)} | ${r.failed} |`),
];
const inter = mean(results.map((r) => r.interAnnotator).filter((x) => !Number.isNaN(x)));
if (!Number.isNaN(inter)) lines.push("", `Labelers agree with each other at ARI ${f2(inter)}, the human reference point for the ARI column.`);

// Decision rule: the fastest config whose ARI is within labeler noise of the best.
const scored = rows.filter((r) => !Number.isNaN(r.ari));
if (scored.length) {
  const best = scored.reduce((a, b) => (b.ari > a.ari ? b : a));
  const tolerance = Number.isNaN(best.labelerSpread) ? 0.03 : best.labelerSpread;
  const pick = scored.filter((r) => r.ari >= best.ari - tolerance && !r.failed).sort((a, b) => a.wallP50 - b.wallP50)[0];
  if (pick) lines.push("", `Best ARI: ${best.name} (${f2(best.ari)}). Within ${f2(tolerance)} of it, the fastest is **${pick.name}** (p50 ${f2(pick.wallP50)}s).`);
  for (const r of scored) if (!Number.isNaN(r.ariFile) && r.ari <= r.ariFile) lines.push(`Warning: ${r.name} does not beat one-chapter-per-file.`);
}
writeFileSync(join(out, "summary.md"), lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
console.log(`\nresults: ${join(out, "results.json")}`);
