# Ticket: The user selects an edge, and the sidebar edits it

## What to build

The engine's hit test becomes the one call of ADR-0025, for nodes and edges in this ticket: a
press on an edge, within 4 screen pixels of its flattened path and not on a node, selects it, and
`onSelectionChange` reports `{ kind: "edge", id }`; a press on a node still selects and drags it.
The cursor shows what a press would do. The example's sidebar shows the selected edge's colour,
dash, arrowhead, and label and changes them through `updateEdge`, as it changes a node's title.

## Acceptance criteria

- [ ] Given random graphs and points, when the engine hits at each level, then it returns the
      node or edge a brute-force scan finds, a node before an edge, the node of the highest rank
      and the edge of the highest slot on top, and
      an edge only within 4 screen pixels of its flattened path.
- [ ] Given an edge between two nodes, when the user clicks on its path, then the edge is
      selected and reported, at the near, middle, and far level (G-5).
- [ ] Given a node over an edge, when the user presses on the node, then the node is selected and
      dragged.
- [ ] Given a selected edge, when the user changes its colour in the example's sidebar, then the
      canvas draws the new colour in the next frame (G-5, G-9).
- [ ] Broken once: with edges hit by their bounds, a press on the empty canvas beside a curved
      edge selects it and the first criterion fails.

## Read first

- ADR-0025, ADR-0012 (*Hit testing*, *Layers*), ADR-0010 (*Structured data*), ADR-0026.
- Glossary: selection, sidebar, level of detail.
- `crates/engine/src/graph.rs` (`hit`), `crates/engine/src/stroke.rs` (the flattening),
  `interaction/index.ts`, the example's `src/main.ts`, `e2e/drag.spec.ts`.

## Blocked by

- docs/plan/editing/05-the-host-adds-and-changes-edges.md

## Mode

with the human: it touches `crates/engine/src/graph.rs` and `crates/engine-wasm/`, protected
parts of ADR-0007.
