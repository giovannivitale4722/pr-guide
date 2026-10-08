import { allHunks } from "./diff.mjs";

// Chapters over this many changed lines get flagged when they could be split.
// Review studies see defect detection drop well before 400 lines.
export const CHAPTER_LOC_LIMIT = 400;

const FLOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption", "nodes", "edges"],
  properties: {
    caption: { type: "string", description: "One line naming the path the diagram shows, e.g. 'Shared content reaches a thread'." },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "added", "chapter"],
        properties: {
          id: { type: "string" },
          label: { type: "string", description: "A real symbol from the code: function, class, component, endpoint." },
          added: { type: "boolean", description: "true if this PR adds it or substantially changes it." },
          chapter: { type: "integer", description: "1-based chapter that introduces it, 0 if none." },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          label: { type: "string", description: "Short edge label, or empty string." },
        },
      },
    },
  },
};

const TITLE = { type: "string", description: "Imperative, specific: 'Build the share extension'." };
const HUNKS = { type: "array", items: { type: "string" }, description: "Hunk ids, in the order a reviewer should read them." };

function guideSchema(chapterProps) {
  // Chapters come before steps and flow: flow nodes refer to chapter numbers,
  // and a streamed response reaches the reviewable part sooner.
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "chapters", "steps", "flow"],
    properties: {
      summary: { type: "string", description: "2-3 sentences: what the PR does and why." },
      chapters: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: Object.keys(chapterProps), properties: chapterProps },
      },
      steps: { type: "array", items: { type: "string" }, description: "3-6 short steps describing how the change works end to end." },
      flow: FLOW_SCHEMA,
    },
  };
}

// The full guide: what the skill writes, and what one API call returns for a
// small PR. Chapters are 1-based in `flow.nodes[].chapter`; 0 means the node
// is existing code that no chapter changes.
export const GUIDE_SCHEMA = guideSchema({
  title: TITLE,
  explanation: { type: "string", description: "Per WRITING.md: why and what, an optional reading map, then a short '- ' list of specific checks. Inline `code` allowed." },
  hunks: HUNKS,
});

// The grouping skeleton for larger PRs: a one-line gist per chapter instead
// of the explanation, which is written afterwards by one call per chapter, in parallel.
export const SKELETON_SCHEMA = guideSchema({
  title: TITLE,
  gist: { type: "string", description: "One sentence: what this chapter changes and why." },
  hunks: HUNKS,
});

// Make the guide safe to render: every hunk appears exactly once, unknown ids
// are dropped, generated files and anything the grouper missed get their own
// chapters, and empty chapters disappear (with flow references renumbered).
export function finalizeGuide(raw, files) {
  const warnings = [];
  const hunks = allHunks(files);
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const seen = new Set();

  let chapters = (raw.chapters || []).map((c, i) => {
    const ids = [];
    for (const id of c.hunks || []) {
      if (!byId.has(id)) { warnings.push(`Chapter ${i + 1} lists unknown hunk "${id}"; dropped.`); continue; }
      if (byId.get(id).generated) continue;
      if (seen.has(id)) { warnings.push(`Hunk ${id} appears in more than one chapter; kept the first.`); continue; }
      seen.add(id);
      ids.push(id);
    }
    return { title: c.title || `Chapter ${i + 1}`, explanation: c.explanation || c.gist || "", hunks: ids, origIndex: i + 1 };
  });

  const missing = hunks.filter((h) => !h.generated && !seen.has(h.id)).map((h) => h.id);
  if (missing.length) {
    warnings.push(`${missing.length} hunk(s) were not assigned to a chapter; added to "Remaining changes": ${missing.join(", ")}`);
    chapters.push({ title: "Remaining changes", explanation: "Changes the guide did not place in an earlier chapter. Review them on their own.", hunks: missing, origIndex: -1 });
  }
  const generated = hunks.filter((h) => h.generated).map((h) => h.id);
  if (generated.length) {
    chapters.push({ title: "Generated files", explanation: "Lockfiles, snapshots and other generated output. Usually safe to skim.", hunks: generated, origIndex: -2 });
  }

  const dropped = chapters.filter((c) => c.hunks.length === 0);
  for (const c of dropped) warnings.push(`Chapter "${c.title}" had no valid hunks; removed.`);
  chapters = chapters.filter((c) => c.hunks.length > 0);

  const renumber = new Map(chapters.map((c, i) => [c.origIndex, i + 1]));
  for (const c of chapters) {
    const hs = c.hunks.map((id) => byId.get(id));
    c.adds = hs.reduce((a, h) => a + h.adds, 0);
    c.dels = hs.reduce((a, h) => a + h.dels, 0);
    c.files = [...new Set(hs.map((h) => h.path))].map((path) => {
      const fh = hs.filter((h) => h.path === path);
      return { path, adds: fh.reduce((a, h) => a + h.adds, 0), dels: fh.reduce((a, h) => a + h.dels, 0) };
    });
    delete c.origIndex;
  }

  const flow = raw.flow || { caption: "", nodes: [], edges: [] };
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  const nodes = flow.nodes.map((n) => ({ ...n, chapter: renumber.get(n.chapter) || 0 }));
  const edges = flow.edges.filter((e) => {
    const ok = nodeIds.has(e.from) && nodeIds.has(e.to);
    if (!ok) warnings.push(`Flow edge ${e.from} -> ${e.to} references a missing node; dropped.`);
    return ok;
  });

  return {
    guide: { summary: raw.summary || "", steps: raw.steps || [], flow: { caption: flow.caption || "", nodes, edges }, chapters },
    warnings,
  };
}

// Problems in a grouping that are worth one more look by the model, found
// without a model call. Structural problems (unknown, repeated or unplaced
// hunks) always need a fix. The rest are flags based on the research on
// tangled changes and review: oversized chapters, tests split from the code
// they cover ("support-hunk drift"), and chapters that use a name a later
// chapter defines (information should come before it is needed).
export function checkGuide(raw, files, ev) {
  const problems = [];
  const hunks = allHunks(files);
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const chapterOf = new Map();
  const chapters = raw.chapters || [];

  chapters.forEach((c, i) => {
    for (const id of c.hunks || []) {
      if (!byId.has(id)) problems.push({ kind: "unknown", chapter: i + 1, message: `Chapter ${i + 1} lists "${id}", which is not a hunk id in this PR.` });
      else if (chapterOf.has(id)) problems.push({ kind: "duplicate", chapter: i + 1, message: `Hunk ${id} is in chapter ${chapterOf.get(id) + 1} and chapter ${i + 1}; it must be in exactly one.` });
      else chapterOf.set(id, i);
    }
  });
  const unplaced = hunks.filter((h) => !h.generated && !chapterOf.has(h.id)).map((h) => h.id);
  if (unplaced.length) problems.push({ kind: "unplaced", message: `These hunks are in no chapter: ${unplaced.join(", ")}. Put each in the chapter whose change it supports, or a new chapter if none fits.` });

  chapters.forEach((c, i) => {
    const hs = (c.hunks || []).map((id) => byId.get(id)).filter(Boolean);
    const loc = hs.reduce((a, h) => a + h.adds + h.dels, 0);
    if (loc > CHAPTER_LOC_LIMIT && hs.length > 1) {
      problems.push({ kind: "oversized", chapter: i + 1, message: `Chapter ${i + 1} "${c.title}" has ${loc} changed lines. Split it if it holds more than one idea; keep it if it is one inseparable change.` });
    }
  });

  if (ev) {
    const chaptersWith = (path) => new Set(hunks.filter((h) => h.path === path && chapterOf.has(h.id)).map((h) => chapterOf.get(h.id)));
    for (const { test, source } of ev.testPairs) {
      const t = chaptersWith(test);
      const s = chaptersWith(source);
      if (!t.size || !s.size || [...t].some((x) => s.has(x))) continue;
      const fmt = (set) => [...set].map((x) => x + 1).join(", ");
      problems.push({ kind: "tests-apart", message: `${test} looks like it tests ${source}, but the test is in chapter ${fmt(t)} and the code in chapter ${fmt(s)}. Put tests with the change they cover unless they really stand alone.` });
    }

    const late = new Map();
    for (const l of ev.links) {
      const d = chapterOf.get(l.from);
      const u = chapterOf.get(l.to);
      if (d === undefined || u === undefined || u >= d) continue;
      if (ev.hunks[l.from]?.test || ev.hunks[l.from]?.cosmetic) continue;
      const k = `${u}:${d}`;
      if (!late.has(k)) late.set(k, new Set());
      late.get(k).add(l.name);
    }
    for (const [k, names] of late) {
      const [u, d] = k.split(":").map(Number);
      const list = [...names].slice(0, 4).map((n) => `\`${n}\``).join(", ");
      problems.push({ kind: "order", chapter: u + 1, message: `Chapter ${u + 1} uses ${list}, which chapter ${d + 1} defines. Move the definition earlier, merge the chapters, or reorder them.` });
    }
  }
  return problems;
}

export const needsRepair = (problems) => problems.some((p) => ["unknown", "duplicate", "unplaced"].includes(p.kind));

// Backticked names in an explanation that appear nowhere in the PR (diff,
// paths, title, description, commits). Generated text about code changes
// often contains made-up identifiers; this catches the plainest cases.
export function ungrounded(explanation, haystack) {
  const out = new Set();
  for (const m of String(explanation).matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1].trim();
    if (raw.length < 3 || /\s/.test(raw)) continue;
    const base = raw.replace(/\(.*\)$/, "").replace(/[;,.:]+$/, "");
    const tail = base.split(/\.|::|\/|#|->/).filter(Boolean).pop() || base;
    if (![raw, base, tail].some((s) => s.length >= 2 && haystack.includes(s))) out.add(raw);
  }
  return [...out];
}

export function prHaystack(pr, files) {
  const parts = [pr.title || "", pr.body || "", ...(pr.commits || []).map((c) => `${c.messageHeadline}\n${c.messageBody || ""}`)];
  for (const f of files) {
    parts.push(f.path, f.oldPath || "");
    for (const h of f.hunks) parts.push(h.context, ...h.lines.map((l) => l.s));
  }
  return parts.join("\n");
}

export function mermaidFlow(flow) {
  if (!flow.nodes.length) return "";
  const ids = new Map(flow.nodes.map((n, i) => [n.id, `n${i}`]));
  const esc = (s) => String(s).replace(/"/g, "#quot;").replace(/[<>]/g, "");
  const lines = ["flowchart LR"];
  for (const n of flow.nodes) {
    // No leading "+": mermaid reads "+ text" as a markdown list item.
    const ch = n.chapter ? ` · ${String(n.chapter).padStart(2, "0")}` : "";
    lines.push(`  ${ids.get(n.id)}["${esc(n.label + ch)}"]`);
  }
  for (const e of flow.edges) {
    const label = e.label ? `|"${esc(e.label)}"|` : "";
    lines.push(`  ${ids.get(e.from)} -->${label} ${ids.get(e.to)}`);
  }
  const added = flow.nodes.filter((n) => n.added).map((n) => ids.get(n.id));
  if (added.length) {
    lines.push("  classDef added fill:#e6f4ea,stroke:#2d8a4e,color:#14361f");
    lines.push(`  class ${added.join(",")} added`);
  }
  return lines.join("\n");
}
