# Ticket: A label drag past every finite world point moves nothing and throws nothing

## What to build

5a58413 guarded two callers of the bridge against a world point that is not finite. The first is
`targetAt`, and its browser test fails without the guard. The second is a label drag, which skips
a move to such a point. That guard has no test. The commit reasons that a label drag begins only
on a hit, at a finite point. But the viewport can change while the drag runs: the host application
may call `setViewport` at any time, and an x of 1e306 at a scale of 0.005 puts every screen point
beyond any finite world point. The next move of the pointer then reaches the guard. Without the
guard, `moveLabel` refuses the point, and an uncaught error reaches the page on every move.

Write the browser test: press a label at the near level, move it, have the page set such a
viewport while the button is held, move again, and release. Assert that no page error arose, that
the label stays where the last finite move put it, and that the release records `labelMoved` once,
with that placement.

## Acceptance criteria

- [ ] Given a label drag in progress, when the host sets a viewport that puts every screen point
      beyond any finite world point and the pointer moves, then no page error arises and the
      label does not move.
- [ ] Given that drag, when the pointer is released, then `onChange` tells `labelMoved` once, with
      the placement of the last finite move.
- [ ] Broken once: with the guard of `interaction/label-drag.ts` removed, the test fails with page
      errors from the moves.
- [ ] Given `bunx --bun playwright test`, when it runs, then every browser test passes.

## Read first

- ADR-0025, ADR-0030 (`labelMoved`); `packages/comb/src/interaction/label-drag.ts`;
  `examples/metric-tree/e2e/label-drag.spec.ts` (the golden path),
  `examples/metric-tree/e2e/far-from-the-origin.spec.ts` (the test of `targetAt`'s guard),
  `examples/metric-tree/e2e/shared.ts` (`setViewport`).
- Conventions: *Break the feature once*, *A refusal added at the bridge is traced to the shell's
  callers*, *Host code may change the graph*.

## Blocked by

- None (can start immediately)

## Mode

unattended: a browser test decides each criterion. The change adds a test under
`examples/metric-tree/e2e/` and touches no protected part of ADR-0007, so a wrong result costs one
revert. The broken-once run proves it right, and a red suite shows it wrong. Stop: if a viewport
set while the button is held ends the drag, or the label cannot be held across the change within
two attempts, hand off with what the drag did. Changing `label-drag.ts` is not this ticket's
work.
