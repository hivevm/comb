# Ticket: ADR-0036 says the press where a drag begins at its first move

## What to build

A decision for the maintainer: two accepted ADRs say different things about when a drag names
its nodes, and the code follows one of them.

- [ADR-0036](../../adr/0036-a-drag-redraws-what-it-moved.md), *Decision*: "at the press,
  interaction writes the slots it drags into the store", and "**The press:** the scene hides the
  dragged nodes' particles and the dragged nodes' edges in what it keeps, once".
- [ADR-0037](../../adr/0037-each-move-its-counter-a-drag-apart.md), *Decision*: a drag's "first
  move names the dragged slots in the store's `dragged`".
- The code: `packages/comb/src/interaction/node-drag.ts` calls `dragStarted` on the first move
  past the slop of 4 screen pixels, never at the press, and `packages/comb/src/render/scene.ts`
  hides the dragged edges and particles on the first frame that finds `dragged` set. A press
  released within the slop is a click on the node's content and must hide nothing, so the code is
  right and ADR-0036's word "press" is not.

ADR-0037 restates ADR-0029 and supersedes it, not ADR-0036, so both stand in force with the two
readings, and a session that reads ADR-0036 alone would move the signal to the press. The
record needs one reading: an ADR that restates ADR-0036 with the drag's first move in place of its
press and supersedes it, or the correction carried by the next normalization. Which, and when, is
the maintainer's choice; this revision proposes no ADR.

## Acceptance criteria

- [ ] Given the choice, when the maintainer makes it, then an ADR restating ADR-0036 is proposed
      in a pull request of ADRs only, or this ticket names the normalization that will carry it,
      or it is deleted with the reason.
- [ ] Given the record after it, when ADR-0036's successor and ADR-0037 are read, then both say
      that a drag names its nodes and hides them at its first move past the slop.

## Read first

- ADR-0036 (*Decision*), ADR-0037 (*The graph's coordinates*), ADR-0022 (ranks).
- `packages/comb/src/interaction/node-drag.ts`, `packages/comb/src/render/scene.ts` (`drag`),
  `packages/comb/src/store/index.ts` (`dragStarted`).

## Blocked by

- None (can start immediately)

## Mode

with the human: ADRs are the maintainer's to decide (`docs/adr/`, a protected part of
[ADR-0007](../../adr/0007-harness.md)), and only a human changes a status.
