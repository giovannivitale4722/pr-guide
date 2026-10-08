// Cheap, language-agnostic structure computed from the diff before any model
// call. The grouping step gets it as hints (identifiers defined in one hunk
// and used in another, test files and the source they cover, cosmetic-only
// hunks); the check step uses it to flag suspect chapters.
//
// Untangling research found structural context helps (+3 to +9 points) but
// that intent reasoning matters more, so this is evidence for the model, not
// a clustering of its own.

import { allHunks } from "./diff.mjs";

// Definitions in the common languages, matched on a changed line.
const DEF_PATTERNS = [
  /\b(?:function\*?|def|fn|func|fun|sub|proc|macro)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)/g,
  /\b(?:class|interface|trait|struct|enum|union|protocol|record|module|namespace|object|type|typedef|impl)\s+([A-Za-z_$][\w$]*)/g,
  // Only top-level variables: indented ones are locals (`const days = ...`
  // inside a function or a test), whose names collide across unrelated code.
  /^(?:export\s+)?(?:const|let|var|val|static)\s+([A-Za-z_$][\w$]*)\s*[:=(]/g,
  /^export\s+default\s+(?:function\s+|class\s+)?([A-Za-z_$][\w$]*)/g,
  /^\s*(?:export\s+)?(?:public|private|protected|internal|static|async|override|readonly|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/g,
  /^\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
];
const KEYWORDS = new Set("if for while switch catch return function constructor else elif try with match case new delete typeof await yield super this self import export from default".split(" "));
// Short, generic names that link unrelated code.
const GENERIC = new Set("start end name value data result results options opts config error err index item items type key keys args params props state ctx context res req request response init run main test setup".split(" "));

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)s?\.[^/]+$|(^|\/)test_[^/]+$|_test\.[^/]+$|Tests?\.[^/]+$/;
const COMMENT = /^\s*(\/\/|#|\/\*|\*|--|<!--|;|%|"""|''')/;

export function isTest(path) {
  return TEST_PATH.test(path);
}

// "src/foo/bar.test.ts" -> "bar"; "tests/test_bar.py" -> "bar"; "BarTest.java" -> "bar".
function stem(path) {
  let s = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  s = s.replace(/[._-](test|spec)s?$/i, "").replace(/^test_/, "").replace(/_test$/, "").replace(/Tests?$/, "");
  return s.replace(/\.[^.]+$/, "").toLowerCase();
}

function changed(h) {
  return h.lines.filter((l) => l.t !== " ");
}

function definitions(h) {
  const names = new Set();
  for (const l of changed(h)) {
    // Comments, and import/export lists (`import { type Foo }` names a type, it doesn't define one).
    if (COMMENT.test(l.s) || /^\s*(import\b|export\s*(\*|\{))/.test(l.s)) continue;
    for (const re of DEF_PATTERNS) {
      re.lastIndex = 0;
      for (const m of l.s.matchAll(re)) if (m[1].length >= 3 && !KEYWORDS.has(m[1]) && !GENERIC.has(m[1])) names.add(m[1]);
    }
  }
  return names;
}

function tokens(h) {
  const out = new Set();
  for (const l of h.lines) for (const m of l.s.matchAll(/[A-Za-z_$][\w$]{2,}/g)) out.add(m[0]);
  return out;
}

// Whitespace-only: the removed and added lines are the same text once all
// whitespace is stripped. Comment-only: every changed non-blank line is a comment.
function cosmetic(h) {
  const ch = changed(h);
  if (!ch.length) return null;
  const norm = (t) => ch.filter((l) => l.t === t).map((l) => l.s.replace(/\s+/g, "")).filter(Boolean).sort().join("\n");
  if (norm("+") === norm("-")) return "whitespace";
  if (ch.every((l) => !l.s.trim() || COMMENT.test(l.s))) return "comments";
  return null;
}

export function buildEvidence(files) {
  const hunks = allHunks(files).filter((h) => !h.generated);
  const defs = new Map(); // name -> [hunk ids]
  const perHunk = {};
  for (const h of hunks) {
    // Tests use the code's names; they don't define names the code uses.
    const d = isTest(h.path) ? new Set() : definitions(h);
    perHunk[h.id] = { path: h.path, loc: h.adds + h.dels, test: isTest(h.path), cosmetic: cosmetic(h), defines: [...d] };
    for (const name of d) {
      if (!defs.has(name)) defs.set(name, []);
      defs.get(name).push(h.id);
    }
  }

  // A link means: hunk `to` uses a name that hunk `from` (a different file's
  // or a different hunk's) defines. Only names defined somewhere in the PR count.
  // Names defined in many hunks (`name`, `config`, `handler`) link everything
  // to everything, so they are left out.
  const links = [];
  for (const h of hunks) {
    const used = tokens(h);
    for (const [name, where] of defs) {
      if (where.length > 3) continue;
      if (!used.has(name)) continue;
      for (const from of where) if (from !== h.id && !perHunk[h.id].defines.includes(name)) links.push({ from, to: h.id, name });
    }
  }

  // Test file -> changed source files it most likely covers: same stem, or
  // it uses a name a source hunk defines.
  const sources = files.filter((f) => !f.generated && !isTest(f.path));
  const testPairs = [];
  for (const f of files.filter((f) => !f.generated && isTest(f.path))) {
    const ids = new Set(f.hunks.map((h) => h.id));
    const covered = new Set(sources.filter((s) => stem(s.path) === stem(f.path)).map((s) => s.path));
    for (const l of links) if (ids.has(l.to) && !perHunk[l.from].test) covered.add(perHunk[l.from].path);
    for (const path of covered) testPairs.push({ test: f.path, source: path });
  }

  return { hunks: perHunk, links, testPairs };
}

// The evidence as compact text appended to the model's view of the PR.
export function evidenceText(ev, { maxLinks = 150 } = {}) {
  const out = ["## Evidence", "Computed from the diff by a script. Use it as hints; it can miss links and include false ones."];

  const byName = new Map();
  for (const l of ev.links) {
    const k = `${l.name}\u0000${l.from}`;
    if (!byName.has(k)) byName.set(k, { name: l.name, from: l.from, to: [] });
    byName.get(k).to.push(l.to);
  }
  const rows = [...byName.values()].sort((a, b) => b.to.length - a.to.length);
  if (rows.length) {
    out.push("", "Names defined in one hunk and used in others (definition -> uses):");
    for (const r of rows.slice(0, maxLinks)) out.push(`- \`${r.name}\` ${r.from} -> ${[...new Set(r.to)].join(" ")}`);
    if (rows.length > maxLinks) out.push(`- (${rows.length - maxLinks} more not shown)`);
  }
  if (ev.testPairs.length) {
    out.push("", "Test files and the changed source they likely cover:");
    for (const p of ev.testPairs) out.push(`- ${p.test} covers ${p.source}`);
  }
  const cos = Object.entries(ev.hunks).filter(([, h]) => h.cosmetic);
  if (cos.length) {
    out.push("", "Cosmetic hunks (whitespace or comments only):");
    out.push(cos.map(([id, h]) => `${id} (${h.cosmetic})`).join(", "));
  }
  return out.length > 2 ? out.join("\n") : "";
}
