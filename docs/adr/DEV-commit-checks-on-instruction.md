# DEV-commit-checks-on-instruction: The checks on each commit of a branch run on a human's instruction, before its integration

- **Status:** 🟢 accepted
- **Date:** 2026-11-17
- **Deciders:** Markus Brigl
- **Applies to:** `scripts/check-commits.sh`, its `# On instruction:` line in `scripts/check-all.sh`, and step 2 of the integration branches in `CONTRIBUTING.md`
- **Extends:** NUC-checks-are-bash §7

## Context

[`scripts/check-commits.sh`](../../scripts/check-commits.sh) runs the checks on every commit of a
branch, each in a temporary worktree of its own: a commit that leans on a later one to pass cannot
be reverted, bisected, or reviewed alone. Step 2 of the integration branches in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) runs it before a reviewed branch is rebased onto a
`feat/` branch. `scripts/check-all.sh` names it on an `# On instruction:` line, and runs its
self-test.

[NUC-checks-are-bash §7](NUC-checks-are-bash.md) names three kinds of script that run only on a
human's instruction: a sensor that reads what only the GitHub repository holds, a sensor whose one
run costs a full run of the checks or more, and a script that changes the repository. The notes of
NUC v0.10.0 hold a project's script on such a line to one of the three. The script is none of them
by the words: it is a check, since it fails on a commit that fails, not a sensor; one run costs a
run of the checks per commit, more than the second kind's bound; and the worktrees it adds it
removes again on every exit, so the repository is as it was.

## Decision

We will run the checks on each commit of a branch only on a human's instruction, as a fourth kind
beside the three of NUC-checks-are-bash §7.

1. **Fourth kind.** A check whose one run costs a run of the checks for each commit of a branch
   runs only on a human's instruction, never in `scripts/check-all.sh` or `checks.yml`.
   `scripts/check-all.sh` names it on an `# On instruction:` line, and its self-test stays in the
   three lists, as NUC-checks-are-bash §7 says of the three kinds.
2. **When.** `scripts/check-commits.sh` is that check. Step 2 of the integration branches in
   `CONTRIBUTING.md` runs it on each reviewed branch before the branch is rebased onto its `feat/`
   branch.

**Out of scope:** which checks `scripts/check-commits.sh` runs on each commit, which its header
names and its self-test holds against `package.json` and `scripts/check-code.sh`; whether CI runs
the checks on each commit of a pull request.

## Alternatives considered

- **The second kind of NUC-checks-are-bash §7, read wide** — no ADR of Comb's own, but the clause
  names a sensor, and a script that fails on what it finds is a check.
- **A run line in `scripts/check-all.sh`** — the checks on each commit on every push, but a push of
  ten commits would run the gate ten times over, and the pre-push hook runs the whole gate already.
- **A job of `checks.yml` per pull request** — a gate nobody forgets, but the jobs would build the
  engine once per commit on every push to a pull request, and the local gate could not run it.

## Sources / Prior art

- [NUC-checks-are-bash §7](NUC-checks-are-bash.md), the clause this ADR extends.
- The notes of NUC v0.10.0, which hold a script on an `# On instruction:` line to the three kinds.

## Consequences

- Positive: the line in `scripts/check-all.sh` names a kind an ADR decides, and the rule of the
  three kinds still holds for every other script on such a line.
- Negative / trade-offs: a commit that fails alone reaches a `feat/` branch where nobody runs the
  script.
- Follow-ups: none.

## Enforcement

The `# On instruction:` line of [`scripts/check-all.sh`](../../scripts/check-all.sh) names
`scripts/check-commits.sh`, and the rule `docs/check-lists` of
[`scripts/check-docs.sh`](../../scripts/check-docs.sh) holds the self-test in the three lists.

**Not mechanically decidable:** that step 2 runs the script before each integration, which the
human who gives the instruction judges.
