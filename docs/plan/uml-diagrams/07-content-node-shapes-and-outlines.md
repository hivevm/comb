# Ticket: The pentagon, the notched rectangle, the note, and the frame, dashed and invisible outlines, and separator rows

## What to build

The host application sets a node shape to `pentagon`, `notched-rectangle`, `note`, or `frame`, and
Comb draws, hits, and lays out each as REN-node-shapes-cover-uml says, the frame's content in its
tab. `outline` takes `"solid"`, `"none"`, or a dash pattern, which the engine lays along the
outline. A content row may be a separator, a line across the node. The Canvas 2D fallback draws
them as WebGL2 does (below).

Settled with the human on 2026-11-18:

- `updateNode` sets `outline` here.
- The engine lays a dashed outline's dashes as geometry, so the Canvas 2D fallback of
  REN-webgl2-or-canvas-fallback draws them dashed, and the new node shapes and separators as WebGL2
  does; only an edge's dashes, whose gaps the WebGL2 shader cuts, are drawn solid there.
- The dashes start at the point of the outline nearest the top left corner of the node's box and
  run clockwise; the pattern starts anew on each node and is checked as an edge's dash pattern is.
  Inspection reports the engine's dash segments, so that criterion 3 measures them against the
  outline.
- A frame's tab is as wide as its content's longest row at its natural width, measured by the
  font's advances, and the padding, at most the frame's width.
- A selected node shows its outline solid in the selection colour, with an outline of `"none"` or
  a dash pattern too. A node with an outline of `"none"` is hit within its outline still.
- A resize of a pentagon, a notched rectangle, or a note sets width and height freely, as ticket 04
  resizes a rectangle; a frame never grows lower than its tab.

## Acceptance criteria

- [ ] Given a node of each of the four node shapes with content, when it loads, then inspection
      reports its inner rectangle and the content laid out in it, the frame's in its tab, and
      `heightOf` gives the height drawn.
- [ ] Given a press inside the pentagon's bounding rectangle beyond its point, when it lands, then
      it hits what lies below.
- [ ] Given a rounded rectangle with a dash pattern `[6, 4]` as its outline, when it is drawn, then
      its dashes lie on the outline within Q-4's precision and follow the pattern; with `"none"`,
      only its fill is drawn.
- [ ] Given content whose second row is a separator, when it loads, then a line is drawn across the
      inner rectangle between the first and the third row.
- [ ] Given the metric tree, when its tests run, then they pass, the reference image of the edges
      among them.
- [ ] Given `updateNode` with an `outline` of `[6, 4]`, when it is called, then the node's outline
      is drawn in those dashes.
- [ ] Given `allowCanvasFallback` and a node with a dashed outline, when it is drawn on the Canvas
      2D renderer, then inspection names that renderer; a pixel sampled just inside the outline,
      within half the stroke width, shows the fill in a gap of the dashes and the outline's colour
      on a dash.

## Read first

- Touches: `crates/engine/src/shape.rs`, `crates/engine/src/content.rs`,
  `crates/engine-wasm/src/graph_data.rs`, `crates/engine-wasm/src/properties.rs`,
  `packages/comb/src/api/snapshot.ts`, `packages/comb/src/render/nodes.ts`
- ADRs: REN-node-shapes-cover-uml, REN-node-content-and-hits (*Separator*),
  REN-webgl2-or-canvas-fallback, API-bridge-columns-carry-nesting.
- Glossary: Node shape, Outline. Conventions: *Geometry is tested on its awkward cases*, *Break the
  feature once, and watch its test fail*.
- Golden path: the node shapes of REN-closed-set-of-node-shapes in `crates/engine/src/shape.rs` and
  `packages/comb/src/render/nodes.ts`.
- Seam: geometry tests of `crates/engine/src/shape.rs`, browser tests in a new
  `examples/metric-tree/e2e/node-shapes-uml.spec.ts`.

## Blocked by

- docs/plan/uml-diagrams/04-nodes-take-a-height-and-are-resized.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface, where a wrong turn costs more than a
revert.
