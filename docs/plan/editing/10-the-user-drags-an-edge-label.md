# Ticket: The user drags an edge label, and it stays where it was dropped

## What to build

G-6's second half. The labels layer hands the engine the half width and half height of each pill
it draws, when its text is drawn or changes; the hit test of ADR-0025 gains labels, inside their
pill, at the near level, above nodes and below connectors. A press on a label selects its edge and
drags the label: on each move the engine places it at the pointer less the grab offset, finding
the path parameter nearest that point and the signed distance along the normal there, and bumps
the store's counter of moved positions, as a node drag does, so that the next frame queries
again and draws it there. At release the store's label takes the final `t` and offset, and
`onChange` delivers one `labelMoved` with `by: "user"`. When a node of the edge moves afterwards,
the label keeps that `t` and offset (G-6).

## Acceptance criteria

- [ ] Given random paths and points, when the engine places a label at a point whose nearest path
      point is inside the path, then the label's position from the `t` and offset it returns lies
      within a hundredth of a world unit of the point, edges that run backwards and edges far from
      the world's origin among them.
- [ ] Given a label at the near level, when the user drags it off its edge and releases, then it is
      drawn where it was dropped, and one `labelMoved` was delivered with that `t` and offset.
- [ ] Given that label, when the user then drags one of the edge's nodes, then the label keeps its
      `t` and offset as the edge moves (G-6).
- [ ] Given a short label beside a long one, when the user presses just outside the short pill,
      then neither label is grabbed.
- [ ] Given the middle level, when the user presses where a label's point lies, then no label is
      dragged.
- [ ] Broken once: with the offset left at its old value, the second criterion fails.

## Read first

- ADR-0025, ADR-0023 (*Delivery*), ADR-0012 (*Layers*, *Text*), ADR-0009 (the nearest path
  parameter is the engine's geometry).
- Glossary: edge label, path parameter, label offset.
- Convention: *Geometry is tested on its awkward cases*.
- `crates/engine/src/geometry.rs` (`label_position`), `render/labels.ts`, `interaction/index.ts`.

## Blocked by

- docs/plan/editing/06-the-user-selects-an-edge.md
- docs/plan/editing/03-a-dragged-node-reports-where-it-landed.md

## Mode

with the human: it touches `crates/engine/src/graph.rs` and `crates/engine-wasm/`, protected
parts of ADR-0007.
