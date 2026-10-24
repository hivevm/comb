# Spec: Editing the graph on the canvas

## Problem

A user of a host application can look at a graph in Comb, pan, zoom, select a node, and drag it,
but cannot change the graph: no node can be added from the host's palette, no edge drawn between
two nodes, nothing deleted, no edge selected, and an edge label stays where the host put it. The
host application, for its part, can only load a whole graph and change a node's title; to add or
remove a single node it has to load everything again, and it never learns what the user did, so
it has nothing to persist.

## Solution

The user drags a node type from the host's palette onto the canvas and the node appears under the
drop. The user drags from one of the four connectors of a node, one in the middle of each side,
to a connector of another node, and an edge appears between them, leaving and entering by those
sides. The user clicks a node or an edge to select it, edits it in the host's sidebar, and
deletes it with Delete or Backspace, a node together with every edge at it. The user drags an
edge label along its edge, and it stays where it was dropped. The host application adds, changes,
and removes single nodes and edges through the public interface, hears every change of the graph
through one listener with a typed change, and can refuse a connection or a deletion the user
makes before Comb makes it.

## Existing behaviour

- A load replaces the whole graph, numbers its nodes and edges into slots from 0, and builds the
  engine's lists of edges per node and its spatial index once. Pinned by the engine's query and
  hit tests against a brute-force scan, the bridge's tests and property test, and the browser
  tests of loading, culling, and malformed data. A load must stay what it is: same slots, same
  refusals, same first-frame time.
- Every edge runs from the right middle of its source to the left middle of its target. Pinned by
  the geometry tests, the budget's property test, and the reference image of the edges in the
  browser tests of edge styles. A graph that names no side must be drawn exactly as today.
- A press on a node selects it and drags it; a press on the empty canvas clears the selection and
  pans; `onSelectionChange` reports it. Pinned by the drag and pan-and-zoom browser tests and the
  interaction tests. A selection of an edge exists in the store's type but nothing makes one.
- `updateNode` changes a node's title, refused against the store's map where the node is unknown.
  Pinned by the malformed-data and hostile-text browser tests.
- Callers move from the old behaviour to the new without a change: every new field of an edge
  has a default, every new method and option is additive, and no existing method changes what it
  accepts or returns.

## Goals served

- G-1 — the host adds a node; the user drops one from the host's palette.
- G-3 — the user connects two nodes by their connectors.
- G-4 — the user deletes the selection; the host removes nodes and edges.
- G-5 — edges become selectable; the host changes an edge's attributes and the canvas shows it.
- G-6 — the second half: dragging a label sets its path parameter and label offset.
- G-9 — advanced: the example's sidebar edits the selected edge, and it gains a palette.
- Q-1 — edits are incremental, never a load per edit, so they hold at 50,000 nodes.
- Q-3, Q-5, Q-6, Q-7 — the new interface is typed, takes no markup, needs no dynamic code, and
  refuses malformed input and unknown identifiers with typed errors, keeping the graph.

## User stories

1. As a user, I want to drag a node type from the palette onto the canvas, so that the new node
   lands where I dropped it.
2. As a host developer, I want to add a single node at a position, so that I can create nodes from
   my own controls without reloading the graph.
3. As a user, I want to drag from a connector of one node to a connector of another, so that an
   edge connects them.
4. As a user, I want a connection released over the empty canvas, over the same node, or over a
   node my source already has an edge to in that direction, to create nothing, so that I cannot
   make a self-edge or a duplicate by accident.
5. As a user, I want to see the connectors of the node under my pointer, and which ones a
   connection I am dragging can end on, so that I know where to release.
6. As a host developer, I want to refuse a connection the user makes before it is created, so
   that my model's rules hold.
7. As a host developer, I want to choose the sides an edge leaves and enters, so that graphs that
   flow top to bottom, or run back, read well.
8. As a user, I want to click an edge to select it, so that I can edit or delete it.
9. As a host developer, I want to change an edge's colour, dash, arrowhead, label, or sides, so
   that my sidebar's edits show on the canvas.
10. As a user, I want Delete or Backspace to delete the selected node or edge while the canvas has
    focus, a node with every edge at it, so that I can remove what I no longer want.
11. As a host developer, I want to refuse a deletion before it happens, seeing every node and edge
    it would remove, so that I can protect what must stay.
12. As a host developer, I want to remove nodes and edges by identifier, so that I can mirror
    deletions made elsewhere.
13. As a user, I want to drag an edge label along and away from its edge, so that it stays where I
    drop it as the nodes move.
14. As a host developer, I want one listener that tells me every change of the graph, typed by its
    kind and by who made it, so that I can persist the user's edits and ignore my own.
15. As a host developer, I want to hear where a dragged node ended up once, when it is dropped, so
    that I persist one position, not one per frame.
16. As a host developer, I want every edit I make through the interface with malformed data or an
    unknown identifier to be refused with a typed error and change nothing, so that a bug of mine
    cannot corrupt the graph.
17. As a user of a graph of 50,000 nodes, I want adding and deleting to cost no visible frame, so
    that editing a large graph stays fluid.

## Implementation decisions

- **Engine, edits in place (ADR-0022):** the engine adds and removes nodes and edges one at a
  time with a free list per kind, last freed first out; each node keeps its own list of the edges
  at it; the grids of the spatial index add and remove single items and grow as slots are
  appended, with the existing rule for building the index again; removing a node removes its
  edges in the same call and returns their slots. A free slot is never returned and is refused
  where a slot is named. The engine chooses each new slot and returns it.
- **Store:** its per-slot lists of nodes and edges hold a hole at a free slot, the map from
  identifiers to slots follows every edit, a selection naming a removed item is cleared, and it
  counts the code units of the identifiers it holds for the limit of a load. Each action that
  changes the graph records the change it made, from which `api` delivers `onChange` (ADR-0011,
  ADR-0023).
- **Public interface (ADR-0023):** `onChange` with the changes `loaded`, `nodeAdded`, `nodeUpdated`,
  `nodeMoved`, `nodesRemoved`, `edgeAdded`, `edgeUpdated`, `edgesRemoved`, and `labelMoved`, each
  with `by`; the methods `addNode`, `removeNodes`, `addEdge`, `updateEdge`, `removeEdges`, and
  `worldPointAt`; the options `canConnect`, synchronous, allowing a connection only by returning the
  new edge's identifier, and `canDelete`, synchronous, allowing only on `true`; the types of the
  sides and of the changes exported beside the existing ones. Each method changes all it names or
  nothing.
- **Validation:** every new input is read once into primitives by `api` and checked by the bridge
  crate as a load would check that node, edge, or field; the limits of a load hold for the graph
  after each edit. Refusals that need the map from identifiers (unknown node or edge, duplicate
  identifier, an edge to a missing node) are `api`'s (ADR-0026). New problem kinds (`unknownEdge`, a
  patch field of an edge Comb does not know) are generated from the bridge crate.
- **Connectors (ADR-0024):** four per node, at the middle of each side; `EdgeData` gains
  `sourceSide` and `targetSide`, defaults `right` and `left`; the path's control points pull along
  each side's outward normal, which for right to left is today's path. A user's connection is made
  only to a connector of another node that the source does not already reach, after `canConnect`,
  under the identifier it returns, checked as any edge's; without `canConnect` no connection begins.
  Connectors are drawn for the node under the pointer and during a connection; the connection being
  dragged is a line in the overlay.
- **Hit testing (ADR-0025):** one engine call returns the target on top at a point: a connector
  (8 screen pixels, near and middle level), an edge label (inside its pill, near level, by
  extents the labels layer hands over when it draws a text), a node, an edge (4 screen pixels of
  its flattened path). A press then begins a connection, a label drag, a node drag, selects an
  edge, or pans.
- **Label drag:** while the label is dragged, the engine places it at the pointer less the grab
  offset by finding the path parameter nearest that point and the signed distance along the
  normal there, so that the label sits where it was dropped; where the nearest point is an end of
  the path, the label sits on that end's normal. The store's label and `labelMoved` are updated
  once, at release, as a dragged node's position is reported once (`nodeMoved`).
- **Self-edges:** `addEdge` and a user's connection refuse an edge from a node to itself; `load`
  keeps accepting one, so the specification's assumption that every edge joins two nodes is not
  enforced for a load (ADR-0024).
- **Draw order (ADR-0022, ADR-0027):** every node has a rank in the engine, a load ranking by slot
  and an added node taking the highest, so a new node is drawn on top even in a freed slot; queries
  return node slots by rank, node views and particles bind in that order, and the hit test takes the
  node of the highest rank.
- **Delete:** the canvas becomes focusable and takes focus when pressed; Delete and Backspace
  delete the selection after `canDelete`, and the key's default action is prevented.
- **Example:** the metric tree gains an HTML palette whose items the user drags onto the canvas,
  and its sidebar edits the selected edge as it edits a node; it logs nothing it does not show.

## Testing decisions

- The engine's edits are tested natively in `crates/engine`, by a property test of random
  sequences of additions, removals, and moves against a brute-force scan, after the pattern of
  the existing query and hit tests against a scan, and by a test that counts index rebuilds.
- The geometry of sides is tested in `crates/engine` for every pair of sides, beside the existing
  path tests, and the budget's property test draws random sides.
- The bridge crate's checks of every new input are tested in its unit tests and its property
  test, after the pattern of the load's.
- The public interface and the gestures are tested in browser tests under the example's `e2e`,
  through `comb` and `comb/testing`, one file per concern after the drag and malformed-data
  files, reading what is drawn through inspection rather than pixels.
- The type of the changes is pinned by a type test after the pattern of the store's
  `GraphView` test.
- Every test of a criterion is broken once before it lands (*Break the feature once*).

## Out of scope

- Undo and redo, copy and paste, and selecting more than one item.
- Node content (G-10), its own spec under ADR-0013.
- Moving a node from the host application, and bringing an existing node to the front.
- Reconnecting an edge by dragging its end; more than one connector per side; typed connectors.
- A refusal the host application gives later than the gesture.
- Edge routing around nodes.

## ADR impact

Binding: ADR-0002 (every criterion met is cited by a test), ADR-0008 (the benchmark of ticket 11),
ADR-0007 (every ticket here touches a protected part, so every ticket is worked with the
maintainer), ADR-0010, ADR-0011, ADR-0027, ADR-0018 (the edges layer's fallback draws
the new paths unchanged), ADR-0021 (the new methods that need the engine throw
`EngineLostError`), and ADR-0013 as proposed only where node content is concerned, which this
spec leaves out.

New, proposed before implementation starts: ADR-0022 (the engine edits its graph in place and draws
a node added last on top), ADR-0023 (the editing interface: typed changes, vetoes, new methods),
ADR-0024 (one connector per side), ADR-0025 (the engine answers every hit test), ADR-0026, which
supersedes ADR-0009 and makes `api` refuse what only the store's map of identifiers knows, and
ADR-0027, which supersedes ADR-0012 and binds node views and particles by rank, edges and edge
labels by slot.
