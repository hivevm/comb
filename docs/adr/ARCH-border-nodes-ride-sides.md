# ARCH-border-nodes-ride-sides: A border node sits on a side of the node it is attached to, at an offset along that side, and moves with it

- **Status:** 🟡 proposed
- **Date:** 2026-11-17
- **Deciders:** Markus Brigl
- **Applies to:** border nodes in `crates/engine/src/graph.rs`, `crates/engine/src/shape.rs`, `crates/engine-wasm/`, and `packages/comb/src/store/`, their drawing in `packages/comb/src/render/`, and their drag in `packages/comb/src/interaction/`

## Context

G-17 attaches a node to the outline of another as a border node: it is drawn centred on that
outline, moves with the other node, stays on the outline while the user drags it, and takes edges
as any node does. UML 2.5.1 draws pins and activity parameter nodes on the border of an action or
an activity, expansion nodes on the border of an expansion region, and entry and exit points on
the border of a state or a state machine (G-20).

A border node is unlike a node in a container
([ARCH-engine-edits-nested-graph](ARCH-engine-edits-nested-graph.md)): the node it is attached to
need not be a container, an action with pins is none, and it sits on the outline, not inside.
Comb already names places on a node by its four sides: an edge docks at the connector of a side or
on the outline ([API-edges-dock-side-or-outline](API-edges-dock-side-or-outline.md)), and every
node shape is drawn and hit within its outline
([REN-closed-set-of-node-shapes](REN-closed-set-of-node-shapes.md)).

The human decided on 2026-11-17 that a border node's place is a side and an offset along it.

## Decision

We will place a border node by a side of the node it is attached to and an offset along that
side, derive its world position in the engine from that node's box and node shape, and move it
with that node.

1. **Attachment.** A border node is a node of the graph data attached to one other node, which
   is no border node. It is no container, lies in the same container as the node it is attached
   to, and is never dropped into a container.
2. **Place.** Its place is one of the four sides of the box of the node it is attached to and an
   offset along that side, in world units from the side's start, its left end or its top end. Its
   centre lies where the line through that point at right angles to the side meets the node's
   outline, so on a rectangle on the side, and on an ellipse or a diamond on the curve or the edge
   of the node shape. The engine keeps its world position from these, as it keeps the world
   positions of nodes in containers.
3. **Moves and resizes.** A move of the node it is attached to moves it in the same call. A resize
   keeps its side and its offset, the offset held within the side's length.
4. **Drag.** A drag of a border node moves its place along the outline, to the point of the
   outline nearest the pointer, onto another side where that one is nearer. It never leaves the
   node it is attached to.
5. **Order.** A border node is drawn and hit directly above the node it is attached to and the
   other nodes of lower rank, its border nodes in the order of their ranks; on a container it lies
   above every container, as every node that is no container does
   ([REN-virtualized-nested-scene](REN-virtualized-nested-scene.md)).
6. **Edges.** An edge docks on a border node as on any node.
7. **Removal.** Removing a node removes its border nodes and every edge at them, in the same call.

**Out of scope:** how the host application describes a border node in its graph data and how its
drag is reported, which the public interface decides; where on a border node an edge docks.

## Alternatives considered

- **A share of the whole outline, 0 to 1** — even for every node shape, but a border node moves
  around a corner when a resize changes the node's proportions.
- **A border node as a node in a container** — no new kind of attachment, but the node it is
  attached to would have to be a container, an action would be one only for its pins, and a node
  in a container lies inside, not on the outline.
- **Pins drawn as content of their node** — no node of their own, but an edge could not dock on a
  pin, and a pin could not be selected or dragged.

## Sources / Prior art

- OMG, *Unified Modeling Language* 2.5.1, the notation of pins, activity parameter nodes,
  expansion nodes, and entry and exit points, the notation the human named for G-20 —
  <https://www.omg.org/spec/UML/2.5.1/> (not read for this draft).
- The human's answer of 2026-11-17 on the place of a border node.

## Consequences

- Positive: a border node stays on its side through moves and resizes, as pins in UML tools do.
- Positive: edges dock on pins and on entry and exit points as on any node.
- Negative / trade-offs: a border node takes a node slot and counts against the limit of a load.
- Negative / trade-offs: a move of a node costs time in its border nodes as well.
- Negative / trade-offs: on a node shape without straight sides, a place given by a side of the
  box is less direct than a share of the outline.

## Enforcement

Each test below cites this ADR with `Verifies: ARCH-border-nodes-ride-sides`.

- A property test of `crates/engine/src/graph.rs` attaches border nodes at random sides and
  offsets to nodes of every node shape, moves and resizes those nodes, drags the border nodes, and
  asserts after each step that each border node's centre lies on its node's outline within the
  accuracy of Q-4, on its side, and that removing a node removes its border nodes and their edges.
- A browser test of the UML example drags a pin of an action around the action's corner and
  asserts through inspection that it stays on the action's outline, then moves the action and
  asserts that the pin and the edge docked on it follow.
