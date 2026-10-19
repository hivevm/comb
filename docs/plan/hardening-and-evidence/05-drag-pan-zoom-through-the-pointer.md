# Ticket: Drag, pan, and zoom through the pointer, cited by browser tests

## What to build

Browser tests drive the example with `page.mouse`: a node dragged across frames follows the
pointer and its edges' ends follow in the same frame (G-2); dragging the empty canvas pans by the
pointer's movement, and a wheel step zooms so that the world point under the pointer stays under
it (G-8). They cite G-2 and G-8.

## Acceptance criteria

- [ ] Given a loaded example, when the pointer drags a node by 200 px in 10 moves, then after each
      rendered frame the node's centre lies under the pointer within 1 px and the ends of every
      edge attached to it lie at the node's connectors (`Verifies: G-2`).
- [ ] Given the empty canvas, when the pointer drags it by (120, −80) px, then the viewport moved
      by that much in screen pixels (`Verifies: G-8`).
- [ ] Given a world point under the pointer, when the wheel zooms in and out, then the point
      stays under the pointer within 1 px and the scale changed (`Verifies: G-8`).
- [ ] Broken once each: edges moved one frame late fail the first; zoom about the viewport's
      centre fails the third.

## Read first

- `docs/SPECIFICATION.md` G-2, G-8; ADR-0011 (one render per frame), ADR-0012.
- `examples/metric-tree/e2e/example.spec.ts`, `comb/testing`'s `screenPoint`, `inspect()`, and
  `whenRendered`.
- `docs/GLOSSARY.md`: viewport, connector.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria (above);
- scope: browser tests only; one revert;
- no protected part of ADR-0007;
- a wrong result shows as a red or flaky browser test; flakiness is a defect, not retried;
  the broken-once runs prove it;
- stop: if "the same frame" cannot be observed without a new hook in `comb/testing` after two
  attempts, hand off with the hook proposed.
