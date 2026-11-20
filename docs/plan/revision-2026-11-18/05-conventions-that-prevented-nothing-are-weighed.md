# Ticket: Five conventions that prevented nothing since 2026-11-07 are dropped or kept by the maintainer

## What to build

The design revision of 2026-11-18 found no commit, review, or rework since 2026-11-07 in which these
entries of `docs/CONVENTIONS.md` prevented or caught anything, and no ADR, criterion, or skill that
cites them:

- "A number says where it was taken."
- "A timed gesture begins from the same view on every runner."
- "Hostile host code in a test answers within bounds."
- "A refusal added at the bridge is traced to the shell's callers."
- "A stacked pull request is retargeted before its base branch goes."

The window held little code of the kinds they govern: no new measurement, no new export of the
bridge, no stacked pull request. That they prevented nothing may say more about the window than
about them. The convention file's own rule is that the revision drops what prevented nothing.

Read each against the history before 2026-11-07, the commit that added it, and what it was added
for. Drop each the maintainer judges a habit, and keep each whose case is merely rare, with a line
in this ticket's hand-off that says why.

## Acceptance criteria

- [ ] Given each of the five entries, when the maintainer has read it with the commit that added
      it, then it is dropped from `docs/CONVENTIONS.md` or kept, and the hand-off says which and
      why.
- [ ] Given an entry dropped, when `rg` searches the tree for its title, then nothing cites it.

## Read first

- Touches: `docs/CONVENTIONS.md`
- [`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done); the header of
  `docs/CONVENTIONS.md`.

## Blocked by

- None (can start immediately)

## Mode

with the human: whether a rare case still earns its entry is a judgement the maintainer makes.
