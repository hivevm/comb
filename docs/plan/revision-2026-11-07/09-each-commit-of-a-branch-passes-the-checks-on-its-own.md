# Ticket: Each commit of a branch passes the checks on its own

## What to build

Three reviews of the state diagram's tickets found "commits that did not stand alone": tickets 01
(4069304), 02 (72831ce), and 03 (f2646dd), each then rebased with autosquash by the maintainer's
leave. Ticket 04's hand-off names docs that lag one commit, and ticket 05's review extracted each
commit with `git archive` and ran the type checker, ESLint, Prettier, and the Bun tests on each by
hand. Ticket 03 ran the traceability, comment-width, and docs checks on each of its seven commits
by hand. No rule of `AGENTS.md`, `CONTRIBUTING.md`, or `docs/CONVENTIONS.md` asks that each
commit pass the checks; the reviews hold the branches to a standard no document states, and the
work to meet it is done by hand each time.

The maintainer decided (2026-11-07) that each commit of a branch passes the checks on its own,
as a check:

1. Which checks: the type checker, the linters, and the unit tests (Bun and Cargo), with the fast
   ones that need no build (`scripts/check-docs.sh`, `scripts/check-traceability.sh`,
   `scripts/check-comment-width.sh`, the formatters); the browser tests stay at the head.
2. Where it runs: a script that runs those checks on every commit between the branch's base and
   its head in a temporary worktree, before the merge, reporting each commit that fails.
3. The rule stands in `CONTRIBUTING.md`; as a rule of agents in `AGENTS.md`, which is the
   template's, it goes to NUC as a proposal, as
   docs/plan/revision-2026-11-03/06-propose-the-check-extensions-to-nuc.md does for its findings.

## Acceptance criteria

- [ ] Given a branch, when the script runs, then it runs the decided checks on each commit
      between the base and the head and fails, naming each commit and check that failed.
- [ ] Given a fixture branch whose middle commit fails the docs check, when the script's
      self-test runs, then the script names that commit and the check and exits non-zero.
- [ ] Given `CONTRIBUTING.md`, when it is read, then it states the rule and names the script.

## Read first

- Touches: `scripts/`, `CONTRIBUTING.md`, `.agents/skills/review/SKILL.md`
- The merge messages of 4069304, 72831ce, f2646dd, and 9e8f882, *Review* and *Doubts*.
- `scripts/sensor-review-binding.sh` and its self-test, the shape of a sensor.
- ADR-0002, for the checks and sensors as bash scripts; ADR-0005, for what goes to NUC.

## Blocked by

- None (can start immediately)

## Mode

with the human: a check under `scripts/` is a protected part of ADR-0007, and a rule for
`AGENTS.md` goes to NUC.
