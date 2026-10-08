# How to write a chapter explanation

The reviewer reads the explanation beside the chapter's hunks, before reading the code. Its job is to make the hunks quick to understand and to aim the reviewer's attention well. The reviewer can see the diff, so don't narrate it. Tell them what the diff can't: why the change exists, how its pieces fit, and where it could go wrong.

## Shape

1. **Why and what, in 1–3 sentences.** Start with the problem or need, then the behaviour after the change, naming the function or component where the core logic lives. Prefer observable behaviour ("an `Either` day can no longer hold both a ride and a rider") to a list of edits. Take the why from the description or commits. If neither gives one, describe the effect and don't guess at motives.
2. **A reading map, when it saves time (one sentence).** Say where to start and which hunks are mechanical: call sites passing a new argument, renames, imports, copy changes. "Start with `canAccept`; the route hunks only pass `incoming` through" can halve the reading time. Skip it when the chapter is small or the reading order is obvious.
3. **What to check, as a short list.** These are the specific places where this change could be wrong. Each item names the code involved and the condition to verify, such as an invariant that must hold, an edge case, a caller or copy of the logic that must stay consistent, or a behaviour change that is intended but easy to miss. Order the items by risk, highest first. Usually 2–4 items; none is fine for a trivial chapter.

Format the list as lines starting with `- `, after a blank line. Use no headings and no other markdown besides `backticks` and occasional **bold**.

## What makes a check worth listing

- **It's specific to this diff.** "Check edge cases" or "make sure this is tested" tells the reviewer nothing. "`reconcileSkippedDays` parses skip ids as dates; an id that isn't `YYYY-MM-DD` is dropped" does.
- **It's verifiable.** The reviewer should be able to settle it from the hunks or by opening one nearby file.
- **It's calibrated.** If something looks like an actual bug, say so plainly and why. If it only needs confirming, phrase it as something to confirm. Don't invent concerns to fill the list. Reviewers focus on what a guide points at, so a weak item takes attention from a real one.
- **It covers what's out of view.** The most useful checks often concern code the diff doesn't show: other callers of a changed function, a default parameter that lets old call sites compile unchanged, a copy of the same logic elsewhere. Say that it isn't shown rather than claiming what it does.

## Also worth saying, when true

- **Tests.** Say what the chapter's tests cover and what they leave out, such as the new branch with no test or behaviour that only manual QA can confirm. Reviewers want this and rarely get it.
- **Mismatches with the description.** If the description claims something this chapter's code doesn't do, or the code does something the description doesn't mention, say so. Attribute claims to the description ("the description says…") rather than repeating them as fact.
- **Links to other chapters.** If the chapter relies on or feeds another, name it by number ("uses the refs from chapter 2") instead of re-explaining it.
- **User-visible changes.** For UI or API changes, say what a user or caller will now see differently, including changed copy, disabled states and error behaviour.

## Length

Fit the length to the chapter's risk, not to a template. A rename or wiring-only chapter needs one or two sentences. A chapter with new logic, state or concurrency deserves the full shape, usually 80–180 words. Every sentence should tell the reviewer something the code alone doesn't.

## Accuracy

- Only name identifiers, files and behaviour that appear in the hunks or the PR text. If a hunk was clipped, say what you can't see.
- Describe what the code does, not how well. Don't call code safe, correct, clean or fine, and don't imply that anything you didn't mention is. The guide aims attention; it does not replace review.
- No filler such as "This chapter covers", "In summary" or "Overall".

## Example

> On an `Either` day a user could be confirmed as a rider and also accept riders. `canAccept` now reports a `conflictDay` when an accepted ride covers one of the request's driving days, and `requestableDays` hides days that already have an accepted rider. `RidesProvider` repeats the check when a request is sent and when the demo driver's delayed reply fires, closing the race the description mentions.
>
> Start with `canAccept` and `requestableDays`; the route hunks only pass the extra list through.
>
> - `incomingForCommute` and `requestableDays` default the new list to `[]`, so a call site that forgets it still compiles and silently skips the check. Callers outside this diff aren't shown.
> - `respondToRequest` leaves a conflicting request unchanged with no message, relying on the disabled Accept button.
> - The new test covers `canAccept` and `requestableDays`, not the delayed decline in `RidesProvider`; the description asks for a manual check of the disabled state.

It works because it starts from the problem, says where the logic is, tells the reviewer what they can skim, and lists three specific, checkable risks, including two that concern code or behaviour the hunks don't show directly.
