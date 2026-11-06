# Ticket: The tree cites ADR-0030 where it cites the superseded ADR-0009 as a rule

## What to build

ADR-0030 supersedes ADR-0009 and restates every clause of it. The acceptance moved the 51
`Verifies: ADR-0009` markers to ADR-0030 and left prose that names ADR-0009 as written, "since a
superseded ADR still explains why" (merge 7660917). But most of that prose cites ADR-0009 as the
authority of a rule in force, not as history, and sends the reader to an ADR that binds nothing
([`AGENTS.md` §2](../../../AGENTS.md#2-start-here): superseded ADRs are not rules). The design
revision corrected `docs/ARCHITECTURE.md`; these remain, by
`git grep -n "ADR-0009" -- . ':!docs/adr/'`:

- `README.md` (the structural check), `CONTRIBUTING.md` (the layout), and `Cargo.toml`;
- comments in `crates/engine/`, `crates/engine-wasm/`, `packages/comb/src/`,
  `examples/metric-tree/e2e/`;
- `scripts/check-structure.sh`, `scripts/test-check-structure.sh`, and
  `.github/workflows/checks.yml`.

Move each citation of a rule to ADR-0030, and keep only those that tell history. Then decide
with the maintainer whether a check, or a sensor that reports and fails nothing, lists citations
of a superseded ADR outside `docs/adr/` after each supersession. `scripts/check-docs.sh` is the
template's, so that part is a proposal to NUC beside
docs/plan/revision-2026-11-03/06-propose-the-check-extensions-to-nuc.md.

## Acceptance criteria

- [ ] Given `git grep -n "ADR-0009" -- . ':!docs/adr/'`, when it runs after the change, then each
      line it prints tells why ADR-0009 was superseded, and none cites it for a rule in force.
- [ ] Given the citations moved, when `scripts/check-all.sh` runs, then it passes, the comment
      width check among it.
- [ ] Given the maintainer's decision on the check or sensor, when it is made, then this ticket
      records it, and a proposal to NUC or a project sensor is filed or written.

## Read first

- Touches: `README.md`, `CONTRIBUTING.md`, `Cargo.toml`, `crates/engine/`, `crates/engine-wasm/`,
  `packages/comb/src/`, `examples/metric-tree/e2e/`, `scripts/check-structure.sh`,
  `scripts/test-check-structure.sh`, `.github/workflows/checks.yml`
- ADR-0030, its header; the merge commit 7660917, section *Doubts*.
- Conventions: *A rule changes everywhere it is stated*.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches protected parts of ADR-0007 (`crates/engine-wasm/`,
`packages/comb/src/api/`, `packages/comb/src/bridge/`, `scripts/check-*.sh`, `.github/`), and it
reverses the choice the acceptance of ADR-0030 made for prose.
