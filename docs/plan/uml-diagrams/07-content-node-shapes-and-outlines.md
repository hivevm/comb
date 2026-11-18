# Ticket: The pentagon, the notched rectangle, the note, and the frame, dashed and invisible outlines, and separator rows

## What to build

The host application sets a node shape to `pentagon`, `notched-rectangle`, `note`, or `frame`, and
Comb draws, hits, and lays out each as REN-node-shapes-cover-uml says, the frame's content in its
tab. `outline` takes `"solid"`, `"none"`, or a dash pattern, which the engine lays along the
outline. A content row may be a separator, a line across the node. The ticket also reads
REN-webgl2-or-canvas-fallback against the new node shapes and outlines; where the Canvas 2D fallback
has to draw them and no ADR says how, the session stops and hands off for an ADR.

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

unattended:

- A test decides each criterion: the browser and unit tests named above.
- The scope is isolated, and a wrong result costs one revert of the branch.
- It touches nothing DEV-implementer-and-fresh-reviewer keeps with the human: no ADR, no
  specification, no CODEOWNERS, no ticket but its own, and it fits under that ADR's cap.
- A wrong result shows in the browser tests and the fresh review; the revert undoes it, and
  `scripts/check-all.sh` green with the criteria's tests proves it right.
- Stop: two failed attempts at the same criterion, or a Canvas 2D question no ADR answers; the
  session writes where it stands into this file and hands off.
