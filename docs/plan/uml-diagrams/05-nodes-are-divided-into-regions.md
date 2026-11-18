# Ticket: A node is divided into regions that hold nodes, and the user drags the line between two

## What to build

The host application divides a node `"across"` or `"down"` into `regions`, each with an identifier,
an optional name, a size, a line, and optionally regions of its own. The engine keeps each region as
a container slot inside what it divides, below the node's content, and derives its box. The scene
draws the lines, solid or dashed, and a name band at a named region's start. Nodes lie in a region
by its identifier. A press on a line drags it, never past what a region holds, and `regionsMoved`
reports it; a resize changes the region at the dragged side and reports it in `nodeResized`. A press
on an empty region selects and drags the divided node, and a drop into a region places the node
there. `updateNode` replaces the regions, and a region left out goes with its content.

Settled with the human on 2026-11-18:

- Where the regions' sizes add up to more than what they divide, the node grows to their sum, as a
  height below the content's is raised; where they add up to less, the last region takes the rest.
  No new refusal.
- The engine states the name band's thickness, 24 world units. The name is set in the role `title`
  and truncated to the band's length. A band of a region above or below others stands at its left,
  its name turned anticlockwise to read from bottom to top.
- A line's drag between regions divided again in the same direction changes, as a resize does
  (ARCH-regions-are-container-slots §6), the inner region at the line, to any depth;
  `regionsMoved` names those too.
- A region is at least 8 world units along its direction, and at least what the boxes of the nodes
  directly in it and its own regions need. A line is hit at the near and the middle level, and the
  cursor shows `col-resize` or `row-resize`.
- The target lookup of ticket 03 skips a divided node and names what lies below it. A load and
  `addNode` refuse a `container` that names a divided node as `invalidContainer`.
- An edge whose end names a region is refused as `missingNode`; `removeNodes` and `updateNode`
  naming a region are refused as `unknownNode`. `nodesRemoved` and `canDelete` never name a
  region, only the nodes and edges that go with it.
- `updateNode` with a list of regions takes the patch's sizes as given, the last region taking any
  rest; a region the patch keeps by its identifier keeps its content.
- Regions count against a load's limit of nodes, and their nesting against its depth.
- Regions become drop targets here, as ticket 03 left them; a test drops a node from one partition
  into another and asserts `nodeMoved` with the new region's identifier.

## Acceptance criteria

- [ ] Given an activity divided across into three partitions, the middle one divided down into two,
      when it loads, then inspection reports the regions' boxes tiling the part below the activity's
      content with their name bands, and their lines drawn.
- [ ] Given a node placed in a region by its identifier, when the user drags the line before that
      region, then the region and its neighbour change size, the node keeps its world position, and
      one `regionsMoved` arrives; the line stops at the node's box.
- [ ] Given a press on a partition where no node lies, when the user drags, then the activity moves
      with its regions and everything in them.
- [ ] Given `updateNode` with a list of regions that leaves one out, when it is called, then that
      region's content is removed and reported, and the other regions take the patch's sizes, the
      last one the rest.
- [ ] Given the property test over random trees of regions, when it runs, then the boxes tile what
      they divide and a query and a hit test find the regions where a scan does.
- [ ] Given an edge whose end names a region, and `removeNodes` and `updateNode` naming one, when
      each is called, then it is refused as `missingNode` or `unknownNode`, the graph as it was.

## Read first

- Touches: `crates/engine/src/graph.rs`, `crates/engine/src/graph/nodes.rs`,
  `crates/engine/src/graph/hit.rs`, `crates/engine/src/graph/tests.rs`,
  `crates/engine-wasm/src/graph_data.rs`, `crates/engine-wasm/src/lib.rs`,
  `packages/comb/src/api/snapshot.ts`, `packages/comb/src/api/editors.ts`,
  `packages/comb/src/render/nodes.ts`, `packages/comb/src/interaction/gesture.ts`
- ADRs: ARCH-regions-are-container-slots, API-edits-report-nested-changes (*Graph data of nesting*,
  *Changes*), REN-node-content-and-hits (*Hit test*), API-bridge-columns-carry-nesting.
- Glossary: Region, Container.
- Golden path: ticket 01's containers and ticket 04's resize.
- Seam: browser tests in a new `examples/metric-tree/e2e/regions.spec.ts`, the engine's property
  tests.

## Blocked by

- docs/plan/uml-diagrams/03-nodes-are-dropped-into-containers.md
- docs/plan/uml-diagrams/04-nodes-take-a-height-and-are-resized.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
