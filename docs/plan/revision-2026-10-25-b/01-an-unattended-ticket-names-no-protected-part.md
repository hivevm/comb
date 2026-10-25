# Ticket: A check refuses an unattended ticket that names a protected part

## What to build

The revision of 2026-10-25 filed fifteen tickets. Thirteen of them said in their *Mode*
"unattended: touches no part the harness ADR keeps with the human". Ten of those named in their own
text a path that ADR-0007 keeps with the maintainer, and their commits touched it:
`packages/comb/src/api/` (tickets 03 and 04), `crates/engine/src/graph/` and
`crates/engine-wasm/` (tickets 06 to 10), and `scripts/check-*.sh` (tickets 11 and 12). The
maintainer caught the claim by reading, after the fact. Nothing in the tree compared the claim
with the paths. `.github/CODEOWNERS` names the protected parts, and every ticket names the paths
its work touches. A check can compare the two.

Write a check, `scripts/check-plan-modes.sh`, with its self-test,
`scripts/test-check-plan-modes.sh`. It reads the protected patterns from `.github/CODEOWNERS`, the
file ADR-0007 says names them, and fails when it reads none. It then reads every ticket under
`docs/plan/`, as the plan frontier sensor does, with HTML comments removed. A ticket whose *Mode*
begins with "unattended" fails when its *What to build* or *Acceptance criteria* names a path, from
the repository root, that a protected pattern covers. The failure names the ticket, the path, and
the pattern. *Read first* is not read, because reading a part does not touch it. Run the check from
`scripts/check-all.sh`, from the `checks.yml` job that runs the others, and from the README's list,
which check 9 of `scripts/check-docs.sh` keeps together.

An alternative for the maintainer to weigh: a sensor at the branch, which compares
`git diff --name-only main...` of a `ticket/` branch with the patterns, when the ticket says
"unattended". It reads what was touched, not what was announced, but it reports only after the
work is done, and a sensor fails nothing. The check here fails while the ticket is being written,
which is when the *Mode* is set.

The check decides the *Unattended work* clause of ADR-0007 for the paths a ticket names. That ADR's
*Enforcement* says what runs unattended is not mechanically decidable. Whether that sentence needs
a superseding ADR, or whether the check stays the project's own rule beside it, is the
maintainer's question.

## Acceptance criteria

- [ ] Given a ticket whose *Mode* begins "unattended" and whose *What to build* names
      `crates/engine/src/graph/tests.rs`, when the check runs, then it fails, naming the ticket,
      the path, and `/crates/engine/src/graph/`.
- [ ] Given the same ticket naming that path only under *Read first*, or a ticket "with the
      human" naming it anywhere, when the check runs, then it passes.
- [ ] Given a `CODEOWNERS` with no pattern, or none at all, when the check runs, then it fails,
      naming the file.
- [ ] Given a glob pattern such as `/scripts/check-*.sh`, when a ticket names
      `scripts/check-docs.sh`, then the check matches it.
- [ ] Given the self-test, when it runs, then it plays each case above in a temporary
      tree, and is broken once: with the *Mode* not read, its first case fails.
- [ ] Given the tree after this ticket, when `scripts/check-all.sh` runs, then it passes.

## Read first

- ADR-0007 (*Protected parts*, *Unattended work*, *Enforcement*), ADR-0002 (checks are bash
  scripts under `scripts/`), ADR-0006 (tickets); `.github/CODEOWNERS`;
  `scripts/sensor-plan-frontier.sh` (how a ticket's sections are read);
  `scripts/check-all.sh`, `.github/workflows/checks.yml`, the README's **Build, Test & Run**.
- Convention: *A check fails on what it cannot read*.

## Blocked by

- None (can start immediately)

## Mode

with the human: the change adds a check, its self-test, and a step of the CI. The check, its
self-test, and the CI are `scripts/check-*.sh`, `scripts/test-check-*.sh`, and `.github/`,
protected parts of ADR-0007, and the check bears on ADR-0007's *Enforcement*.
