# Ticket: Numbering the draft ADRs passes the pre-commit hook

## What to build

`scripts/number-adrs.sh` numbers the draft ADRs in two commits: first only `docs/adr/`, the
renames and the references inside it; then every reference outside it. Its header says the
checks fail on the first commit and pass on the second. But the pre-commit hook
(`.githooks/pre-commit`) runs `scripts/check-docs.sh` on the working tree whenever a commit stages
a Markdown file, and refuses the first commit while the tree outside `docs/adr/` still cites draft
identifiers that no file carries. So `scripts/ready-for-main.sh` stops at step 3, the renames left
uncommitted (seen on 2026-11-06 for PR #82, numbering ADR-0031 to ADR-0033).

The working tree was numbered by hand then, in the script's own two commits: the references
outside `docs/adr/` were rewritten in the working tree before the first commit, which staged only
`docs/adr/`, and were committed second (5a4f692, 7c469fe). Since the hook reads the working tree,
the script can do the same: rewrite every reference first, then commit `docs/adr/` alone and the
rest after it. Both commits keep rule 4 of
[`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), and no hook is bypassed.

`scripts/number-adrs.sh` and its self-test come from NUC, the template, so the fix also goes
upstream as a proposal, beside
docs/plan/revision-2026-11-03/06-propose-the-check-extensions-to-nuc.md.

## Acceptance criteria

- [ ] Given a branch that took up `main` and carries draft ADRs cited outside `docs/adr/` (in a
      Markdown file and in a `Verifies:` marker of a test), when `scripts/number-adrs.sh` runs with
      the git hooks enabled, then it makes both commits, and the first holds only `docs/adr/`.
- [ ] Given the two commits, when `scripts/check-docs.sh` runs on the tip, then it passes.
- [ ] Given `scripts/test-number-adrs.sh`, when it runs, then a fixture with the pre-commit hook
      installed decides the first criterion, and it failed before the fix.
- [ ] Given the fix, when it lands, then the script's header no longer says the checks fail on the
      first commit, and a proposal to NUC is written or added to its ticket.

## Read first

- Touches: `scripts/number-adrs.sh`, `scripts/test-number-adrs.sh`
- `.githooks/pre-commit` (read, not changed); ADR-0002 on draft identifiers and their numbering;
  `CONTRIBUTING.md`, *Integration branches*, step 7.
- The merge of PR #82 (3be6c60), its *Doubts*.

## Blocked by

- None (can start immediately)

## Mode

with the human: the script it changes writes `docs/adr/` in every real run, and it is held against
`.githooks/pre-commit` and `scripts/check-docs.sh`, all protected parts of ADR-0007; the
maintainer also decides what goes to NUC. A test decides its criteria (the self-test's fixture
with the hook installed), and the stop is three attempts at a fixture that reproduces the refusal,
or any need to change the hook, after which the session writes what it found here and hands off.
