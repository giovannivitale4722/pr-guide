---
name: pr-guide
description: Turn a GitHub pull request into a guided review - an overview with a flow diagram, then numbered chapters that each group related hunks of the diff with an explanation. Use when the user asks to break up, walk through, explain, or make a review guide for a PR (a number, URL, or owner/repo#123).
argument-hint: <pr number | url | owner/repo#123>
allowed-tools: Bash(node:*), Bash(gh pr view:*), Bash(gh pr diff:*), Read, Write
---

# PR guide

Build a chaptered review guide for the PR in `$ARGUMENTS` (if empty, use the PR for the current branch: `gh pr view --json number -q .number`).

`SCRIPTS` below means the `scripts/` folder next to this file.

## 1. Fetch

```bash
node SCRIPTS/prguide.mjs fetch <pr>
```

This downloads the PR with `gh`, splits the diff into hunks with ids like `f3h2`, computes an evidence index (names defined in one hunk and used in others, test files paired with their source), and prints the working directory `DIR`. If `gh` is not logged in, tell the user to run `gh auth login` and stop.

## 2. Group

Read `GROUPING.md` and `WRITING.md` (next to this file) and follow them. Then read `DIR/for-model.txt` in full. It holds the description, commits, every hunk, and the evidence index at the end. For large PRs, read it in parts until you have seen every hunk id.

Write `DIR/guide.json` matching the schema printed by `node SCRIPTS/prguide.mjs schema`. Write it directly with the Write tool; don't generate it with a script. Fit each explanation's length to the chapter's risk, as WRITING.md describes; most of the time this step takes is spent writing them.

## 3. Render and check

```bash
node SCRIPTS/prguide.mjs render DIR
```

This checks that every hunk appears exactly once, puts lockfiles and snapshots in a "Generated files" chapter, and writes `DIR/guide.html` and `DIR/comment.md`.

- If it reports unknown or unassigned hunks, fix `guide.json` and run it again.
- It also prints review flags: oversized chapters, tests placed apart from the code they cover, chapters that use a name a later chapter defines, and explanations naming identifiers that appear nowhere in the PR. These are heuristics. Fix the ones that are real, in one pass, and render again; leave the rest. Fix every flagged identifier that you did invent.
- A small "Remaining changes" chapter is acceptable only when those hunks really don't fit anywhere.

## 4. Show it

- If the Artifact tool is available, publish `DIR/guide.html` with it (icon: `code`, description: one sentence naming the PR). Otherwise copy `guide.html` into the working directory and tell the user to open it.
- Reply with the link, the chapter titles in one short list, and any warnings or flags you left in place from step 3.
- Offer to post the summary as a PR comment. Only if the user says yes, run `node SCRIPTS/prguide.mjs comment DIR`. Running it again updates the same comment.
