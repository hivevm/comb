# Ticket: A commit whose documentation checks are red is refused before it lands

## What to build

Twice in the changes counted, a commit landed on a branch while `scripts/check-docs.sh` failed
on it, and a later commit fixed what the check named: 63dfb36 left a line of 132 columns in
ticket 07 of revision-2026-10-31 (check 15, prose width), fixed by b353eea; abb4234 cited a
section of `AGENTS.md` outside a link in ticket 13 (check 4), fixed by 877c3ae. The author had run
the check, but through `… | tail -1`, whose exit status is `tail`'s: the pipe reported success for a
check that failed. A later run read the failure, one commit and one round later each time.

The hooks under `.githooks/` refuse a commit on `main` (`pre-commit`), a red push (`pre-push`),
and a red merge commit on `main` (`pre-merge-commit`, which runs `scripts/check-docs.sh` and takes
about half a minute); nothing runs the documentation checks when a commit is made on a branch.
A pre-commit check where the commit stages a Markdown file would have refused both commits.
Choose the simplest form that stays fast enough for every commit, the whole `check-docs.sh` or the
checks of it that read the staged files alone, and say in the pull request what a commit costs
with it. The hooks and `scripts/check-docs.sh` may be the template's (ADR-0005), in which case
the change goes upstream to hivevm/nuc on the maintainer's decision, and this project takes it
with the next template release.

## Acceptance criteria

- [ ] Given a branch and a staged Markdown file with a prose line of 101 columns, when it is
      committed, then the commit is refused, naming the file, the line, and the check.
- [ ] Given a commit that stages no Markdown file, when it is committed, then the documentation
      checks do not run.
- [ ] Given the self-test (`scripts/test-git-hooks.sh`), when it runs, then it plays both cases in
      a temporary repository, beside the cases it holds.

## Read first

- ADR-0007 (the protected parts), ADR-0005 (template releases), ADR-0002.
- `.githooks/pre-commit`, `.githooks/pre-merge-commit`, `scripts/test-git-hooks.sh`,
  `scripts/check-docs.sh` (checks 4 and 15).

## Blocked by

- None (can start immediately)

## Mode

with the human: `.githooks/` and `scripts/test-git-hooks.sh` are protected parts of
[ADR-0007](../../adr/0007-harness.md), and the hooks may be the template's (ADR-0005), whose
change goes upstream.
