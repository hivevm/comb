# Ticket: Draw the edges of a layer as one mesh

## What to build

The edges in the viewport are drawn by one mesh built from the path points the engine computes
into an engine-owned buffer, with each edge's colour, dash pattern, and arrowhead taken from the
graph data, in place of one `Graphics` redrawn per change.

## Acceptance criteria

- [ ] Given an edge, when the engine computes its path points, then they lie on the edge's path
      within 0.5 px of the reference computation at every zoom level used by the example.
- [ ] Given the example with one tree, when a browser test takes a screenshot, then the edges show
      their colours, dashes, and arrowheads, and match a reference image within a tolerance.
- [ ] Given the drag and selection test of ticket 01, when a node is dragged, then its edges
      follow in the same frame.
- [ ] Given the scene, when the structural check of ADR-0012 runs, then no `Graphics` per edge and
      no `Text` exist in the render layer.
- [ ] Given `bun run bench`, when the ticket closes, then the pull request reports its numbers
      against the baseline and ticket 03.

## Read first

- ADR-0012 (the edge mesh), ADR-0010 (path points as a `Float32Array` view), Q-4 of the
  specification.
- The engine's geometry tests, which the path-point tests extend.

## Blocked by

- docs/plan/large-graphs/03-culling.md

## Mode

with the human: it adds a bridge export and a shader, and a reference image is approved by eye.
