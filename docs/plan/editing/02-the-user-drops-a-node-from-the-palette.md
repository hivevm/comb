# Ticket: The user drops a node from the host's palette

## What to build

G-1's second half. The host application gets `worldPointAt(clientX, clientY)`, the world point
under a point of the page, and the example gains an HTML palette of its node kinds beside the
sidebar: the user drags an item with HTML drag and drop onto the canvas, the example reads the
drop's client point, asks `worldPointAt`, and calls `addNode` there. Comb itself handles no
drag and drop.

## Acceptance criteria

- [ ] Given a viewport panned and zoomed, when the host asks `worldPointAt` for the client point of
      a screen point, then it returns the world point that `screenPoint` of `comb/testing` takes
      back to that screen point, within a hundredth of a pixel.
- [ ] Given `worldPointAt`, when a coordinate is not finite, then it throws a `RangeError`; once
      the engine is lost, it still answers.
- [ ] Given the example, when the user drags a palette item onto the canvas and drops it, then a
      node of that kind is drawn at the world point under the drop, and the example's listener
      received its `nodeAdded` (G-1).
- [ ] Broken once: with the canvas's offset in the page left out, the first criterion fails for a
      canvas not at the page's corner.

## Read first

- ADR-0023, ADR-0009 (*Direction*: the example imports only the package's entries).
- Glossary: palette, host application, viewport.
- `interaction/viewport.ts` (`toWorld`), `api/index.ts` (`setViewport`), the example's
  `src/main.ts` and `src/style.css`.
- The seam: a browser test in `examples/metric-tree/e2e/`, after `pan-zoom.spec.ts`.

## Blocked by

- docs/plan/editing/01-the-host-adds-a-node.md

## Mode

with the human: it adds a method to `packages/comb/src/api/`, a protected part of ADR-0007.
