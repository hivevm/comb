# Ticket: A merge commit runs the documentation checks first

## What to build

Three times in the work since the revision of 2026-10-25, a commit left `scripts/check-all.sh`
red with a line of Markdown over 100 columns. That happened in 638bb67, in c1b6a6e, and in the
ticket text that 71653fc wrote. Twice a merge then took the red state to `main`. Merge 995942a
carried the 158-column line of ticket 15, which a later branch wrapped (8695dc8). The revision's
own merge carried two blockers the plan frontier sensor could not read, which 95b48c8 fixed.
[`AGENTS.md` §6](../../../AGENTS.md#6-project-rules) lets a branch commit freely and refuses a
push while the checks are red. A local merge into `main` runs neither hook: a merge commit that git
records itself runs no `pre-commit`, and `pre-push` runs only when the merged result is pushed.

Add a `pre-merge-commit` hook under `.githooks/`. Git runs it before it records a merge commit.
When the checkout is on `main`, it runs `scripts/check-docs.sh` and
`scripts/sensor-plan-frontier.sh`, the checks these merges broke, which take about half a minute
together. It refuses the merge while either fails, naming it. `scripts/test-git-hooks.sh`
exercises it as it exercises the two hooks there.

A fast-forward records no merge commit and runs no hook. The maintainer decides whether to accept
that, or to ask for `merge.ff false` in the clone, the way the Dev Container sets
`core.hooksPath`. The hooks may be the template's (ADR-0005). If they are, the hook goes upstream
to hivevm/nuc on the maintainer's decision, as ticket 22 of the revision of 2026-10-24 does with
the sensor.

## Acceptance criteria

- [ ] Given a branch whose Markdown holds a prose line of 101 columns, when it is merged into
      `main` with a merge commit, then the hook refuses the merge and names
      `scripts/check-docs.sh`.
- [ ] Given a branch whose ticket names a blocker the plan frontier sensor cannot read, when it
      is merged into `main`, then the hook refuses it and names the sensor.
- [ ] Given a green branch, or a merge into a branch other than `main`, when it is merged, then
      the hook lets the merge through.
- [ ] Given `scripts/test-git-hooks.sh`, when it runs, then it plays the three cases above in a
      temporary repository, and is broken once: with the hook's check taken out, the first case
      fails.

## Read first

- [`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done) and
  [`AGENTS.md` §6](../../../AGENTS.md#6-project-rules); ADR-0005 (template releases); ADR-0007
  (*Protected parts*); `.githooks/pre-commit`, `.githooks/pre-push`, `scripts/test-git-hooks.sh`;
  `.devcontainer/devcontainer.json` (`core.hooksPath`).

## Blocked by

- None (can start immediately)

## Mode

with the human: `.githooks/` and `scripts/test-git-hooks.sh` are protected parts of ADR-0007, the
hooks may be the template's (ADR-0005), and whether a fast-forward is allowed is the maintainer's
decision.
