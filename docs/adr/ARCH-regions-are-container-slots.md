# ARCH-regions-are-container-slots: A node's regions are containers the engine keeps in slots of their own, inside the node they divide

- **Status:** 🟡 proposed
- **Date:** 2026-11-17
- **Deciders:** Markus Brigl
- **Applies to:** the regions of a node in `crates/engine/src/graph.rs`, `crates/engine-wasm/`, and `packages/comb/src/store/`, the drawing of regions in `packages/comb/src/render/`, and the drag of a line between regions in `packages/comb/src/interaction/`

## Context

G-16 divides a node into regions, side by side or one above the other, each with an optional
name, and treats each region as a container of its own: a node placed in a region stays in it, and
the user drags the line between two regions. UML 2.5.1 draws activity partitions this way, nested
ones among them, and the orthogonal regions of a composite state (G-20).

[ARCH-engine-edits-nested-graph](ARCH-engine-edits-nested-graph.md) already keeps containers:
slots that hold other nodes, positions relative to a container, world positions the engine sums,
a draw and hit order with containers below the other nodes, and removal with the content.
[REN-virtualized-nested-scene](REN-virtualized-nested-scene.md) draws containers in a layer of
their own. A region needs each of these, and only its box differs: it follows from the node it
divides and the sizes of its neighbours, not from a position of its own.

The human decided on 2026-11-17 that a region can be divided again, as UML's nested partitions
are; that each region has an identifier of its own, so that inserting or removing one leaves the
others and their content where they were; and that a region's name stands in a band at its start,
at the top of regions side by side and at the left, turned, of regions one above the other.

## Decision

We will keep each region of a node as a container of the engine, in a slot of its own inside the
node or the region it divides, with a box the engine derives from that node's box and the sizes
of the regions.

1. **Regions in a slot.** Each region takes a node slot of the engine, marked as a region and as a
   container, lying in the node or the region it divides. Nodes lie in a region as in any
   container, at positions relative to the region's top left corner. A divided node or region is a
   container whose content is its regions alone: a node lies in one of its regions, never beside
   them.
2. **Identifiers.** A region has an identifier of its own, from the same space as the identifiers
   of nodes: no node and no region of a graph share one. The shell's map from identifiers to slots
   holds both. A region is no node of the host application's graph data: it stands in the regions
   of the node it divides, never alone.
3. **Division.** A node or a region is divided side by side or one above the other, never both.
   Each region has a size along that direction in world units. The engine derives each region's
   box from the sizes and the extent of what they divide. Where the sizes add up to more than that
   extent, what they divide grows to their sum. A region that grows so grows what it lies in in
   the same way, up to the divided node. Where the sizes add up to less, the last region takes the
   rest. The regions of a node divide the part of its box below its content: a composite state's
   name and compartments, or a frame's tab, stand above its regions, never in them. A region may be
   divided again, to any depth.
4. **Name band.** A region with a name has a band at its start, at the top of a region side by
   side with others, at the left of one above or below others, its name turned there by a quarter
   turn. A region without a name has none.
5. **Lines.** The scene draws the line between two neighbouring regions, solid or with the dash
   pattern the host application gives. A press on a line drags it. The drag changes the sizes of
   the two regions beside it. It also changes the regions inside them at the line, to any depth,
   as a resize does. The other regions keep their sizes. A region never grows smaller than 8 world
   units, than the boxes of the nodes that lie directly in it, or than its own regions need.
6. **Resizing what is divided.** A resize of the divided node (G-15) changes the region at the
   side the user drags, and the regions inside it at that side, to any depth; the others keep
   their sizes.
7. **Drawing and hitting.** A region is drawn and hit as a container is
   ([REN-virtualized-nested-scene](REN-virtualized-nested-scene.md)), above the node it divides. A
   press on a region that hits no node inside it selects and drags the node it divides, as a press
   on that node would. A drop into a region places the node in the region (G-14).
8. **Removing a region.** Removing a region removes everything it holds, as removing a container
   does ([ARCH-engine-edits-nested-graph](ARCH-engine-edits-nested-graph.md)). The regions that
   stay take the sizes the host application gives them. The last of them takes any rest.

**Out of scope:** how the host application describes regions in its graph data and how a line's
drag is reported, which the public interface decides; a selection of a region of its own.

## Alternatives considered

- **Regions drawn by the scene alone, without slots** — no slot per region, but every drop, hit
  test, and query would ask where a node's regions lie, beside the containers the engine already
  keeps, and the content of a region would need its own relative positions.
- **A node with regions inside a region, for nested partitions** — no division of a region, but
  the user has to place the inner node to fill the region, and their sizes drift apart.
- **Regions named by their place in the list** — simpler, but inserting a region renumbers the
  regions after it and moves their content.
- **The name at the top left inside the region** — the form of named orthogonal regions, but
  swimlanes then lose the band that tells them apart.
- **Weights instead of sizes** — the regions keep their shares when the node is resized, but a
  swimlane widened by the user would widen its neighbours too.

## Sources / Prior art

- OMG, *Unified Modeling Language* 2.5.1, the notation of activity partitions and of the regions
  of a state, the notation the human named for G-20 — <https://www.omg.org/spec/UML/2.5.1/> (not
  read for this draft).
- The human's answers of 2026-11-17 on nested regions, their identifiers, and their names.

## Consequences

- Positive: drops, hit tests, queries, culling, and removal treat a region as the containers they
  already handle; a region adds a box to derive, not a new kind of item.
- Positive: inserting or removing a region leaves the identifiers and the content of the others.
- Negative / trade-offs: each region takes a node slot and counts against the limit of a load.
- Negative / trade-offs: a move of a line changes the boxes of two regions and the world positions
  of what they hold, at a cost linear in what they hold.
- Negative / trade-offs: a region cannot be selected on its own; the host application edits it
  through the node it divides.
- Follow-ups: selecting a region on its own, should a host application need it.

## Enforcement

Each test below cites this ADR with `Verifies: ARCH-regions-are-container-slots`.

- A property test of `crates/engine/src/graph.rs` divides nodes into random trees of regions,
  moves lines, resizes the divided nodes, and asserts after each step that the regions' boxes tile
  what they divide with their name bands, that no line moved past the boxes of what a region holds,
  and that a query and a hit test find the regions and their content where a scan finds them.
- A browser test of `examples/metric-tree/` divides a node into partitions, one of them divided
  again. It drags a line between two and asserts through inspection that the regions' boxes and
  the nodes in them are drawn where the engine reports them. It asserts that a node dropped into a
  partition lies in it. It presses a partition where no node lies and asserts that the divided node
  is selected and dragged. It removes a partition through the host application and asserts that
  its content goes and the partitions that stay take the sizes the host gave, the last one the
  rest. A test of the engine asserts that a composite state's regions lie below its content.
