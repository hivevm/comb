# Ticket: A node takes the height its data gives, and the user resizes it by its handles

## What to build

`NodeData.height` gives a node a height, never less than its content needs. A node without content
takes the height its data gives, or its width, however small. A selected node whose `resizable` is
`true` shows eight resize handles in the overlay; a drag of one resizes the node from that side or
corner, never smaller than its content and the boxes of the nodes it holds. The content keeps its
world position, and `nodeResized` reports the new box and the moved content. The resize redraws
through the moving layer and queries only at the release.

## Acceptance criteria

- [ ] Given a node with content and a `height` below the content's, when it loads, then it is as
      high as its content; with a greater one, as high as the data says, and `heightOf` still
      answers the content's height.
- [ ] Given a node without content and a `height` of 10, when it loads, then it is 10 high.
- [ ] Given a selected resizable container holding a node, when the user drags its left handle
      outwards, then the container grows to the left, the node keeps its world position, and one
      `nodeResized` arrives with the new box and the node's new relative position in `moved`.
- [ ] Given the same container, when the user drags its right handle inwards past the node it holds,
      then it stops at the node's box.
- [ ] Given a node that is not resizable, when it is selected, then no handle is drawn and a press
      there hits what lies below.
- [ ] Given a resize at the fitted view of 50,010 nodes, when it runs, then it queries in no frame
      before the release.

## Read first

- Touches: `crates/engine/src/content.rs`, `crates/engine/src/shape.rs`,
  `crates/engine/src/graph/hit.rs`, `crates/engine-wasm/src/graph_data.rs`,
  `crates/engine-wasm/src/properties.rs`, `packages/comb/src/api/snapshot.ts`,
  `packages/comb/src/api/changes.ts`, `packages/comb/src/interaction/gesture.ts`,
  `packages/comb/src/render/scene.ts`, `packages/comb/src/render/moving.ts`
- ADRs: REN-node-content-and-hits (*Layout*, *Hit test*), REN-node-shapes-cover-uml (*Height*),
  API-edits-report-nested-changes (*Resizing*, *Changes*), REN-moving-layer-moves-content,
  API-bridge-columns-carry-nesting.
- Glossary: Resize handle. Conventions: *Check a value as the engine keeps it*.
- Golden path: the node drag; the connectors drawn in the overlay.
- Seam: browser tests in a new `examples/metric-tree/e2e/resize.spec.ts`, layout tests of
  `crates/engine/src/content.rs`.

## Blocked by

- docs/plan/uml-diagrams/02-containers-are-edited-and-dragged.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
