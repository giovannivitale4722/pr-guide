# pr-guide

Turns a GitHub pull request into a guided review: an overview with a before/after flow diagram, then numbered chapters that each group related hunks of the diff with a short explanation.

It works in two places, sharing the same code:

| | Who groups the diff | Output |
|---|---|---|
| **Claude Code skill** (`/pr-guide 123`) | Claude, in your session | Interactive page (published as an Artifact), optional PR comment |
| **GitHub Action** | Claude API (`claude-opus-5-5`) | PR comment with collapsible chapters and a Mermaid diagram, plus the interactive page as a workflow artifact |

## How it works

```
fetch + split into hunks ─► evidence index ─► group ─► check ─► review (if flagged) ─► explain chapters ─► render
      prguide.mjs fetch                       skill or group.mjs                                  prguide.mjs render
```

1. **Fetch** splits the diff into hunks (`f1h1`, `f1h2`, …) and computes an evidence index: names defined in one hunk and used in others, test files paired with the source they cover, and whitespace- or comment-only hunks. The model gets it as hints.
2. **Group** puts hunks into chapters by intent. Tests go with the code they cover, definitions come before their uses, and the riskier chapter comes first when two don't depend on each other. Chapter size, not a fixed count, decides how many chapters there are.
3. **Check** flags problems without a model call: unplaced or repeated hunks, chapters over about 400 changed lines, tests separated from their code, chapters that use a name a later chapter defines, and explanations that name identifiers found nowhere in the PR.
4. **Review** runs only when something is flagged: one more call fixes the grouping.
5. **Explain.** On larger PRs, the grouping call returns only a compact skeleton, and each chapter's explanation is then written by its own call, in parallel.

The coverage check still guarantees that a reviewer never misses part of the diff. Every hunk lands in exactly one chapter, anything left over goes into "Remaining changes", and lockfiles and snapshots go into "Generated files".

These choices follow published research on splitting tangled changes, ordering code for review, and LLM latency. The full write-up is in [`docs/research.md`](docs/research.md).

## Use it in Claude Code

Install it as a plugin, from inside Claude Code:

```
/plugin marketplace add giovannivitale4722/pr-guide
/plugin install pr-guide@pr-guide
```

Or from your shell: `claude plugin marketplace add giovannivitale4722/pr-guide`, then `claude plugin install pr-guide@pr-guide`.

You need Node 18 or later and the GitHub CLI logged in (`gh auth login`). Then, in any repo:

```
/pr-guide:pr-guide 123
/pr-guide:pr-guide https://github.com/owner/repo/pull/123
/pr-guide:pr-guide owner/repo#123
```

With no argument it uses the PR for the current branch. You can also just ask Claude to "walk me through PR 123".

To update later: `claude plugin marketplace update pr-guide`, then `claude plugin update pr-guide@pr-guide`.

<details><summary>Without the plugin system</summary>

Copy the skill folder into your personal skills, and it runs as plain `/pr-guide 123`:

```bash
git clone https://github.com/giovannivitale4722/pr-guide
cp -R pr-guide/skills/pr-guide ~/.claude/skills/pr-guide
```

</details>

## Use it as a GitHub Action

On every pull request, the Action reads the diff, asks Claude to group it into chapters, and posts one comment on the PR: the summary, the flow diagram, and each chapter as a collapsible section. The comment's "Open the interactive guide" link opens the full page (chapter dots, arrow keys, "Mark reviewed") straight in the browser, for anyone signed in with read access to the repo. A new push updates the same comment.

### Set it up for a repo

1. **Add your Claude API key as a secret.** In the repo: Settings → Secrets and variables → Actions → New repository secret, named `ANTHROPIC_API_KEY`. Or from a terminal:

   ```bash
   gh secret set ANTHROPIC_API_KEY --repo OWNER/REPO
   ```

2. **Add the workflow.** Save this as `.github/workflows/pr-guide.yml` on the default branch (it's also in [examples/pr-guide.yml](examples/pr-guide.yml)):

   ```yaml
   name: PR guide
   on:
     pull_request:
       types: [opened, ready_for_review, synchronize]
   concurrency:
     group: pr-guide-${{ github.event.pull_request.number }}
     cancel-in-progress: true
   permissions:
     contents: read
     pull-requests: write
   jobs:
     guide:
       if: ${{ !github.event.pull_request.draft }}
       runs-on: ubuntu-latest
       steps:
         - uses: YOUR-GITHUB-USER/pr-guide@v1
           with:
             anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

3. **Open a pull request,** or push to an open one. The comment appears when the run finishes. Draft PRs are skipped until they're marked ready.

### Options

| Input | Default | What it does |
|---|---|---|
| `anthropic-api-key` | (required) | Your Claude API key. |
| `model` | `claude-opus-5-5` | Model that groups the diff into chapters. |
| `effort` | `medium` | Grouping effort (`low` to `max`). The main speed lever. |
| `explain-model` | same as `model` | Model that writes chapter explanations on larger PRs. `claude-sonnet-5-5` is faster. |
| `explain-effort` | `low` | Effort for chapter explanations. |
| `speed` | `standard` | `fast` uses Opus fast mode: faster output at 2x price. |
| `comment` | `true` | Set to `false` to skip the PR comment and only upload the page. |

### Things to know

- **Forks:** pull requests from forks don't receive repository secrets, so the Action can't run on them.
- **Where the page lives:** the guide page is uploaded as an unzipped workflow artifact. It follows the repo's access rules and expires with its artifacts (90 days by default). It's also listed under the run's artifacts.
- **Cost and time:** small PRs (under about 20k tokens) use one call. Larger PRs use one grouping call plus one call per chapter, run in parallel. A review call runs only when the check flags something. Each run writes `run.json` with the time and tokens of every call.
- **Very large PRs** are clipped per hunk to fit, and the model is told which hunks were clipped.

## Measure before changing defaults

The defaults are the research's best guess, not measurements on this tool. `bench.mjs` compares configurations on real PRs:

```bash
ANTHROPIC_API_KEY=... node skills/pr-guide/scripts/bench.mjs suite.json --runs 3
```

For each configuration it reports:
- agreement with human chapter labels (adjusted Rand index), next to the one-chapter-per-file baseline
- hunks left out, ordering flags, tests kept with their code, and grounded identifiers
- wall-clock p50/p90 and token counts

It then picks the fastest configuration whose agreement is within labeler noise of the best. The comment at the top of `bench.mjs` documents the suite format. A good suite is 30–50 PRs of mixed size and kind, each split into chapters by two people.

## Files

- `skills/pr-guide/SKILL.md`: the skill's instructions
- `skills/pr-guide/GROUPING.md`: how to split a PR into chapters, shared by the skill and the Action
- `skills/pr-guide/WRITING.md`: how to write a chapter explanation
- `skills/pr-guide/scripts/prguide.mjs`: CLI with `fetch`, `schema`, `render` and `comment` (no dependencies)
- `skills/pr-guide/scripts/lib/evidence.mjs`: the evidence index
- `skills/pr-guide/scripts/group.mjs`: the Action's Claude API pipeline (needs `@anthropic-ai/sdk`)
- `skills/pr-guide/scripts/bench.mjs`: compares configurations for quality and speed
- `action.yml`: the composite GitHub Action
- `examples/hono-5448/`: a sample guide for [honojs/hono#5448](https://github.com/honojs/hono/pull/5448)
