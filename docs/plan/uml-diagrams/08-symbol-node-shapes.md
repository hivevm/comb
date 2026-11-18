# Ticket: The crossed circle, the cross, the actor, and the hourglass, and small nodes without content

## What to build

The host application sets a node shape to `crossed-circle`, `cross`, `actor`, or `hourglass`. Comb
draws the first two as filled node shapes without content, and the last two as a drawing above their
content, laid out below to the node's width. A node without content of any node shape is as small as
its data gives, so a pin, an entry point, or a junction can be a small open or filled node shape. A
small filled circle stays a `circle`.

Settled with the human on 2026-11-18:

- A node without content is as small as its data gives from ticket 04; this ticket asserts it of
  the new node shapes alone.
- An actor or an hourglass without content is as high as its drawing; a height its data gives is
  raised to that.
- A resize of a crossed circle or a cross sets width and height together, as ticket 04 resizes a
  circle; a resize of an actor or an hourglass sets both freely, never lower than its drawing and
  its content.
- Content in a crossed circle or a cross is refused with the kind that exists,
  `contentInFilledShape`; no new kind.

## Acceptance criteria

- [ ] Given a node of each of the four node shapes, when it loads, then inspection reports its
      outline and, for the actor and the hourglass, the drawing's box and the content below it, and
      `heightOf` gives the height drawn.
- [ ] Given content in a crossed circle or a cross, when it loads, then it is refused as
      `contentInFilledShape`, naming the node.
- [ ] Given a crossed circle and a cross of width 12 without a height, when they load, then each
      is drawn 12 by 12, and a circle of width 12 is drawn as a junction.
- [ ] Given an actor without content and a `height` below its drawing's, when it loads, then it is
      as high as its drawing.
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

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface, where a wrong turn costs more than a
revert.
