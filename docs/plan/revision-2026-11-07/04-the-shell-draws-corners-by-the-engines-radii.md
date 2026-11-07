# Ticket: The shell draws a node's corners by the radii the engine hits them by

## What to build

`packages/comb/src/render/nodes.ts` draws a rectangle's corners with `RECTANGLE_RADIUS = 6` and a
rounded rectangle's with `ROUNDED_RADIUS = 10`, and its comment says they are "the engine's
`RECTANGLE_RADIUS` and `ROUNDED_RADIUS`, which it hits them by". The engine has
`ROUNDED_RADIUS = 10.0` in `crates/engine/src/shape.rs` and no `RECTANGLE_RADIUS`: it hits a
rectangle as its whole rectangle, corners included. One number is written twice with nothing that
ties the copies (ticket 01 of the state diagram, merge 4069304, *Could not confirm*), and the
comment states a premise the code does not hold (the convention *A premise is read in the code*).

Tie the rounded rectangle's radius to the engine's by a test that compares what the shell draws
with what the engine hits: the drawn outline that `inspect` reports for a rounded rectangle and a
press just inside and just outside its corner arc, at the near level. Correct the comment on the
rectangle's radius: ADR-0032's *Hit test* hits a rectangle by its bounding rectangle, "its corners
of 6 included", so the 6 is the shell's alone and the engine hits no radius of it.

## Acceptance criteria

- [ ] Given a rounded rectangle at the near level, when a press lands just inside its drawn corner
      arc and one just outside it, then the first selects the node and the second does not, and the
      test fails when `ROUNDED_RADIUS` in `packages/comb/src/render/nodes.ts` is changed to 6.
- [ ] Given `packages/comb/src/render/nodes.ts`, when it is read, then no comment names an engine
      constant that `crates/engine/src/` does not define.

## Read first

- Touches: `packages/comb/src/render/nodes.ts`, `crates/engine/src/shape.rs`,
  `examples/metric-tree/e2e/node-shapes.spec.ts`
- ADR-0032, *Decision* (drawing) and *Enforcement*.
- The convention *Break the feature once, and watch its test fail*.
- The seam: `inspect` of `comb/testing`, its `outline` per node.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the browser test above, and the comment read in review;
- its scope is one render module and one browser test, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a node hit beside its drawn corner, or a failing browser test;
  `scripts/check-all.sh` green and the breakage named in the hand-off prove it right;
- stop: when ADR-0032 is read to require a radius the engine does not hit by, or
  `scripts/check-all.sh` is still red after three attempts at a fix, the session leaves its state
  here and hands off.
