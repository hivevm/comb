# Ticket: The crossed circle, the cross, the actor, and the hourglass, and small nodes without content

## What to build

The host application sets a node shape to `crossed-circle`, `cross`, `actor`, or `hourglass`. Comb
draws the first two as filled node shapes without content, and the last two as a drawing above their
content, laid out below to the node's width. A node without content of any node shape is as small as
its data gives, so a pin, an entry point, or a junction can be a small open or filled node shape. A
small filled circle stays a `circle`.

## Acceptance criteria

- [ ] Given a node of each of the four node shapes, when it loads, then inspection reports its
      outline and, for the actor and the hourglass, the drawing's box and the content below it, and
      `heightOf` gives the height drawn.
- [ ] Given content in a crossed circle or a cross, when it loads, then it is refused with the kind
      that names the node.
- [ ] Given a rectangle without content and a `height` and `width` of 10, when it loads, then it is
      drawn 10 by 10, and a circle of width 12 is drawn as a junction.
- [ ] Given a press on the actor's drawing, when it lands, then it hits the actor.

## Read first

- Touches: `crates/engine/src/shape.rs`, `crates/engine/src/content.rs`,
  `crates/engine-wasm/src/graph_data.rs`, `crates/engine-wasm/src/properties.rs`,
  `packages/comb/src/render/nodes.ts`
- ADRs: REN-node-shapes-cover-uml, REN-node-content-and-hits (*Layout*).
- Glossary: Node shape. Conventions: *Geometry is tested on its awkward cases*.
- Golden path: the filled node shapes `circle` and `ringed-circle`.
- Seam: as ticket 07.

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
- Stop: two failed attempts at the same criterion; the session writes where it stands into this file
  and hands off.
