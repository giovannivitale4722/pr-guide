# How to group a PR into chapters

You are writing a review guide for a pull request. A reviewer reads an overview, then steps through numbered chapters. Each chapter shows a subset of the diff's hunks with a short explanation. Your output matches the JSON schema you were given.

## Chapters

- A chapter is one idea a reviewer can hold in their head, such as "Stage shared items" or "Send from the share sheet". "Changes to utils.ts" is not a chapter.
- Group by intent, not by file. A chapter carries everything its idea needs: the code, the types and config it introduces, and the tests that cover it. One file's hunks can belong to different chapters.
- Two mistakes are common. The first is lumping unrelated hunks together because they share a file. The second is attaching a test or helper to whichever change sits nearest in the diff instead of the change it actually supports. Before placing a test or helper, ask which change it exists for.
- Within a chapter, list hunk ids in reading order: definitions before their callers, so the reviewer meets each name before it is used.
- Order chapters so each depends only on earlier ones. When two chapters don't depend on each other, put the riskier or more central one first, because reviewers give the most attention to what they see first. Tests stay inside the chapter they cover. A test-only or docs-only chapter is fine only when those changes truly stand alone, and it goes after the chapters it relates to.
- Let size, not a target count, decide how many chapters there are. Keep each chapter small enough to review in one sitting, ideally under about 400 changed lines, unless it is one change that can't be split. A tiny PR can have one or two chapters. Don't give a trivial hunk its own chapter; fold it into the change it serves.
- Put each non-generated hunk in exactly one chapter. Use only ids that appear in the input. Generated files are assigned automatically, so leave them out.
- The input may end with an "Evidence" section. It lists names defined in one hunk and used in others, test files paired with the source they likely cover, and whitespace- or comment-only hunks. A script computed it, so treat it as hints, not rules. Purpose wins when they disagree.

## Overview

- `summary`: 2–3 sentences on what the PR does and why it exists. Take the why from the description and commits when they give one.
- `steps`: 3–6 short steps describing how the change works end to end.
- `title` (per chapter): imperative and specific, under 7 words.
- `gist` (per chapter, when the schema asks for it): one sentence on what the chapter changes and why. A separate step writes the full explanation from it.

## Flow diagram

`flow` shows the main path through the code after this change: the entry point, then each function, component or service that a request or piece of data passes through.

- Use 4 to 10 nodes, each a real symbol name (`takeShare()`, `ShareSheet`, `POST /threads/:id/messages`).
- For nodes this PR adds or substantially changes, set `added: true` and set `chapter` to the 1-based number of the chapter that introduces them. Existing code that the new path passes through gets `added: false` and `chapter: 0`. A few existing nodes show where the new code plugs in.
- An edge `label` is optional (use an empty string) and is only for branches, such as "files" vs "thread".
- If the PR has no meaningful flow (a dependency bump, a docs fix), return empty `nodes` and `edges` and an empty `caption`.

When the schema includes `explanation`, follow WRITING.md for it.

Base everything on the diff, description and commits. Don't invent behaviour you can't see. If a hunk was clipped, describe only what is visible.
