# Ticket: Decide whether each commit of a branch passes the checks on its own

## What to build

Three reviews of the state diagram's tickets found "commits that did not stand alone": tickets 01
(4069304), 02 (72831ce), and 03 (f2646dd), each then rebased with autosquash by the maintainer's
leave. Ticket 04's hand-off names docs that lag one commit, and ticket 05's review extracted each
commit with `git archive` and ran the type checker, ESLint, Prettier, and the Bun tests on each by
hand. Ticket 03 ran the traceability, comment-width, and docs checks on each of its seven commits
by hand. No rule of `AGENTS.md`, `CONTRIBUTING.md`, or `docs/CONVENTIONS.md` asks that each
commit pass the checks; the reviews hold the branches to a standard no document states, and the
work to meet it is done by hand each time.

For the maintainer to decide, and then to carry out:

1. Whether each commit of a branch passes the checks on its own. If not, the reviews stop
   asking, and the review skill's standards say so.
2. If so, which checks: the fast ones that need no build (`scripts/check-docs.sh`,
   `scripts/check-traceability.sh`, `scripts/check-comment-width.sh`, the formatters) are cheap
   per commit; the browser tests are not.
3. Where it runs: a sensor that runs those checks on every commit between the branch's base and
   its head in a temporary worktree, reporting to the reviewer as sensors do, beside
   `scripts/sensor-review-binding.sh`. The rule itself, as a rule of agents, belongs to
   `AGENTS.md`, which is the template's: it goes to NUC as a proposal, as
   docs/plan/revision-2026-11-03/06-propose-the-check-extensions-to-nuc.md does for its findings.

## Acceptance criteria

- [ ] Given the maintainer's decision, when it is recorded here, then either the review skill or
      a convention says that the commits need not stand alone, or a sensor and its self-test list
      each commit of a branch that fails a named fast check.
- [ ] Given the sensor, when it runs on a fixture branch whose middle commit fails the docs check,
      then it names that commit and the check, and it fails nothing.

## Read first

- Touches: `scripts/`, `.agents/skills/review/SKILL.md`
- The merge messages of 4069304, 72831ce, f2646dd, and 9e8f882, *Review* and *Doubts*.
- `scripts/sensor-review-binding.sh` and its self-test, the shape of a sensor.
- ADR-0002, for the checks and sensors as bash scripts; ADR-0005, for what goes to NUC.

## Blocked by

- None (can start immediately)

## Mode

with the human: whether it is a rule at all is the maintainer's, a sensor under `scripts/` is a
protected part of ADR-0007, and a rule for `AGENTS.md` goes to NUC.
