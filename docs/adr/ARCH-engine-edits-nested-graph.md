# ARCH-engine-edits-nested-graph: The engine edits its graph in place, one node or edge at a time, reuses freed slots, nests nodes in containers, and draws containers below the other nodes

- **Status:** 🟡 proposed
- **Date:** 2026-11-17
- **Deciders:** Markus Brigl
- **Applies to:** `crates/engine/src/graph.rs`, `crates/engine/src/spatial.rs`, the exports of `crates/engine-wasm` that add and remove nodes and edges, the order in which `packages/comb/src/render/` binds node views and particles, and the map from identifiers to slots and the per-slot lists of `packages/comb/src/store/`
- **Supersedes:** [ARCH-engine-edits-graph-in-place](ARCH-engine-edits-graph-in-place.md)

## Context

G-1, G-3, and G-4 ask for nodes and edges to be added and removed one by one: the host
application adds a node or an edge, the user connects two nodes or deletes the selection. A
load builds the whole graph: the node and edge buffers, the lists of edges at each node, and both
grids of the spatial index, each sized for the items it was built with. Lists of edges built as
one packed array (`offsets` and `incident`) would take no item in or out, so that changing the
graph's structure through a load would mean building all of it again.

Q-1 asks for 60 fps with 50,000 nodes and 50,000 edges. A load of that graph takes a good part of
Q-2's second, so an edit that reloads costs that much per edit, and a host application that adds
nodes in a loop pays it each time. A frame of 16.7 ms has no room for it.

A slot is the index of a node or an edge in the engine's buffers, the same on both sides of the
bridge ([API-bridge-columns-carry-nesting](API-bridge-columns-carry-nesting.md)). The shell keeps
the map from identifiers to slots, and every call into the engine after a load names slots
([API-bridge-columns-carry-nesting](API-bridge-columns-carry-nesting.md), *Slots*).
[API-bridge-columns-carry-nesting](API-bridge-columns-carry-nesting.md) leaves open when slots are
compacted after deletions. Removing an item leaves its slot empty; what fills it decides whether
slots stay dense, whether the buffers grow with every edit, and in what order nodes are drawn, since
the scene and the hit test need an order of nodes that says which one is on top
([REN-virtualized-nested-scene](REN-virtualized-nested-scene.md)). A node the host application adds
has to come to the front, where the user dropped it, also when it takes a freed slot below others;
slot order alone cannot give that. [REN-virtualized-nested-scene](REN-virtualized-nested-scene.md)
binds node views and particles in the order of the nodes' ranks below, and edges and edge labels in
slot order.

The spatial index is a uniform grid over the extent it was built for; items beyond the extent
fall into its border cells, it counts them, and it is built again once more than an eighth of the
items, and at least 16, lie beyond (`Graph::translate`). An item that would cover more than 64
cells lives in an overflow list every query scans.

G-14 places nodes in containers, at any depth: a node in a container is drawn above it and moves
with it, the user drops a node into a container or out of every one, and an edge connects nodes at
any depth. UML 2.5.1 needs it for activity partitions, interruptible and expansion regions,
composite states, and the subject of a use case (G-20). The host application gives a node's
position relative to its container, so that a container's move is one change of one node. A node
may reach past its container's outline. Removing a container removes what it contains. These
answers are the human's (2026-11-17).

Every edge lies below every node ([REN-virtualized-nested-scene](REN-virtualized-nested-scene.md)),
so a container drawn as a node would cover the edges between the nodes it contains. A container
is therefore drawn below every edge, and every other node above every container. That parts with
the rule of [ARCH-engine-edits-graph-in-place](ARCH-engine-edits-graph-in-place.md) that a node
added last is drawn above every other node and hit first, so this ADR restates that ADR with
containment added.

## Decision

We will edit the engine's graph in place, one node or edge at a time: an addition takes the most
recently freed slot of its kind, or a new slot after the last, a removal frees its slot and takes
the item out of the spatial index and out of the lists of edges at its nodes, no edit builds the
graph again, nor its index beyond the rule that rebuilds it after growth and moves, and every node
carries a rank that orders drawing and hitting, a node added taking the highest; a node lies in
a container or on the canvas, at a position relative to its container, and containers are drawn
and hit below the other nodes.

- **Free slots:** the engine keeps a list of free slots for nodes and one for edges, last freed
  first out. An addition pops from it, or appends a slot after the highest when it is empty. The
  engine chooses the slot and returns it; the shell records it. A load empties both lists and
  numbers slots from 0, so a load gives node `i` and edge `i` slot `i`.
- **A free slot holds nothing:** no query, hit test, or inspection returns it. An export that
  names a free slot treats it as a slot beyond the graph: where that is refused, it is refused,
  and where inspection answers for it instead, with NaN for its ends, it answers so; the shell's
  mistake never comes back as a stale node. Its position and size stay in the buffers until the
  slot is taken again, and nothing reads them: a rebuild of the index, its extent, its cell side,
  and the counts of its rule cover only the slots in use.
- **Lists of edges at a node:** each node slot keeps its own list of the edge slots at it; adding
  an edge appends to the lists of its ends, removing one takes it out of them. The engine answers
  which edges are at given nodes without removing anything, so that the shell can name them
  before a deletion; removing a node removes every edge at it in the same call and returns their
  slots, so that the shell learns which edges went with it.
- **The spatial index:** the grids add an item into the cells its bounds meet and remove it from
  them, growing their per-item records as slots are appended. The extent stays; an item added
  beyond it counts as one moved beyond it, and the rule that builds the index again after moves
  holds for additions as it does for moves. Removing an item that lay beyond the extent lowers
  the count. Since a grid has at most four cells per item it was built for, the index is also
  built again once the slots in use of a kind exceed twice the count it was built for, so that a
  graph loaded small and grown inside its extent keeps cells as small as a load would give it.
  A rebuild costs what the index part of a load costs, at most once per doubling or per eighth
  of the items moved beyond the extent, so its cost per edit is constant on average; the frame
  that holds it may miss Q-1.
- **Containers:** a node is a container where the host application marks it so. Every node lies in
  one container or on the canvas, at any depth. The engine keeps, per node slot, the slot of its
  container or none, and per container slot the list of the slots it contains, as it keeps the
  lists of edges at a node. A load or an edit that would put a node in a node that is no container,
  in itself, or in a node it contains, is refused with a typed error, and the graph stays as it was.
- **Positions:** a node's position is relative to the top left corner of its container, or a world
  position on the canvas. The engine keeps each node's world position, the sum of the positions
  along its chain of containers, in the buffers that queries, the hit test, the edge geometry, and
  the spatial index read. A move of a container moves the world positions of everything it
  contains and their entries in the spatial index in the same call, in time linear in what it
  contains, and every edge at them follows.
- **Bounds:** each node is culled, queried, and hit by its own box alone. A node may reach past its
  container's outline; a container's box does not grow to hold it.
- **Moving into a container:** an export puts a node into a container or onto the canvas and keeps
  its world position, so its relative position changes. The node takes the next rank, as an added
  node does.
- **Removing a container:** removing a container removes everything it contains, at every depth,
  and every edge at any of them, in the same call, and returns their slots.
- **Draw order of nodes:** the engine keeps a rank per node slot, a `u32`. A load ranks node `i` as
  `i`, so that after a load rank order is slot order; each node added takes the next rank, one above
  the highest given. Containers come before all other nodes. Among containers, a container comes
  after its own container, and containers in one container, or on the canvas, come in the order of
  their ranks, each followed by what it contains. The other nodes come in the order of their ranks,
  whatever container they lie in, each followed directly by the border nodes attached to it
  ([ARCH-border-nodes-ride-sides](ARCH-border-nodes-ride-sides.md)) in the order of their ranks; a
  border node of a container follows every container, at the place of the container's rank among the
  other nodes. This is the one order of drawing and hitting nodes. A query returns the containers it
  found and the other nodes it found as two lists in that order, and the shell binds node views and
  particles in the order it returns them, so the last bound is drawn on top. The hit test of nodes
  takes, of the nodes that hold the point, the last in that order: a node that is no container
  before every container, and among containers the last. Where the next rank would pass `u32::MAX`,
  the engine first renumbers the ranks in use from 0 in their order, once per four billion
  additions. Edges and edge labels keep slot order.
- **The limits of a load**
  ([ARCH-one-workspace-per-example](ARCH-one-workspace-per-example.md)) hold after
  every
  edit: the slots in use of each kind stay within the limit, and because a free slot is taken before
  a new one, so does the highest slot.
- **The shell's side:** the map from identifiers to slots drops the identifier of a removed item
  and gains that of an added one with the slot the engine returned. The store's per-slot lists of
  nodes and edges hold no entry at a free slot; every reader of them skips such a hole, as the
  scene already reads only the slots a query returns. A selection that names a removed item is
  cleared.

**Out of scope:** the layer the scene draws containers in; how the host application marks a
container and how a move into one is reported and refused, which the public interface decides;
where an edge at a container docks; compacting slots between loads, which this decision makes
unnecessary; adding or removing many items as one batch, beyond removing a node's edges and a
container's content with it; undo, which the host application owns
([ARCH-graph-in-zustand-store](ARCH-graph-in-zustand-store.md)).

## Alternatives considered

- **Keeping ARCH-engine-edits-graph-in-place** and drawing a container as any other node, by its
  rank — no new order, but a container added last covers every edge and every node inside it.
- **Absolute world positions for every node** — no sum along the chain, but a move of a container
  writes and reports the position of everything it contains.
- **One order for the whole tree, edges of each container drawn above it** — the drawing of UML
  tools, also where two containers overlap, but one edge mesh and one draw call per container
  instead of one in all, against Q-1 where a diagram holds many containers.
- **A container that grows to hold what it contains** — no node reaches past its outline, but
  every move near the outline resizes the container and reports a change the user did not make.
- **A container that clips what reaches past it** — nothing drawn outside, but a mask per
  container, and an edge to a clipped node ends where nothing is drawn.
- **Content moved up a level when its container is removed** — nothing lost, but UML tools remove
  a composite state, a partition, or a subject with what it holds, and the user deletes a part
  where the whole was meant.
- **The tree of containers kept by the shell alone** — no change to the engine, but the engine's
  queries, hit test, and edge geometry need world positions, so the shell would write every
  descendant's position across the bridge on each move of a container.
- **Reload per edit** — no new code in the engine, and every edit is exactly a load, but an edit
  then costs what a load costs, against Q-1 at 50,000 nodes.
- **Append only, removed slots left as holes** — a new node always takes the highest slot, so it is
  drawn on top, but every addition grows the buffers and the grids for good. A session that adds and
  removes reaches the limit of 1,000,000 slots without holding as many items, and needs the
  compaction [API-bridge-columns-carry-nesting](API-bridge-columns-carry-nesting.md) leaves
  open, which renumbers slots under the
  shell's map.
- **A draw-order key the shell keeps** — the scene would sort the found node slots by a key of
  its own per frame, in JavaScript, and the engine's hit test would still need the same key to
  find what is drawn on top, so the key would cross the bridge anyway.
- **Nodes never reuse a slot** — a new node then is always the highest slot and on top, but the
  node buffers grow with every addition, as under *Append only*.
- **Swap-remove, the last slot moved into the freed one** — slots stay dense and no free list is
  needed, but the moved item changes its slot: the shell's map, the store's lists, every edge
  that names the moved node, and every view bound to it would follow, in one edit.
- **Lowest free slot first** — slots fill from the bottom, which keeps the highest slot low, but a
  heap or a sorted set instead of a list, for a gain the limits do not need.
- **A packed list of edges per node, rebuilt on an edit** — one array for all nodes, as a load
  alone would need; an edit would rebuild it in time linear in the edges, the cost this decision
  avoids.

## Sources / Prior art

- [ARCH-engine-edits-graph-in-place](ARCH-engine-edits-graph-in-place.md), which this ADR restates
  with containment added.
- The human's answers of 2026-11-17 on positions, layers, nodes past the outline, and removal.
- The slot map and the generational arena, which reuse freed slots through a free list: the
  `slotmap` crate — <https://docs.rs/slotmap>; and Catherine West, *Using Rust for game
  development* (RustConf 2018) — <https://kyren.github.io/2018/09/14/rustconf-talk.html> (both read
  2026-10-24). This
  decision keeps the free list without generations, because the shell's map from identifiers is
  the one source of names, and every name is checked against it before a slot crosses.
- `Graph::new`, `Graph::translate`, and `Grid` in `crates/engine` (read on 2026-10-24).

## Consequences

- Positive: an edit costs time in the number of edges at the nodes it touches and the cells their
  bounds cover, plus the overflow list the removal searches, not in the size of the graph, which
  serves Q-1.
- Positive: slots stay as dense as the graph is large; buffers grow only with the graph.
- Positive: a load stays what it is, so Q-2 and every test of a load keep their meaning.
- Positive: a node the host adds appears on top of every node that is no container, where the
  user dropped it, and is hit first.
- Positive: a container's move is one change of one node for the host application, and the edges
  between the nodes it contains stay visible above it.
- Negative / trade-offs: a move of a container costs time in what it contains; dragging a
  container with thousands of nodes inside it may miss Q-1 in that frame.
- Negative / trade-offs: where two containers overlap, a node inside the lower one is still drawn
  above the upper one, and edges are drawn above both, which UML tools would not do.
- Negative / trade-offs: a node that reaches past its container's outline is not clipped, so a
  diagram can show a node outside the container it belongs to.
- Negative / trade-offs: a query sorts the node slots it found by rank, `k log k` for `k` found,
  the same cost as a sort by slot; the engine keeps four bytes per node for the rank.
- Negative / trade-offs: node order and slot order part after the first addition, so a test or a
  reader that takes the highest slot for the top node is wrong from then on.
- Negative / trade-offs: the frame in which a rebuild for growth or moves falls costs what the
  index of a load costs, which at 50,000 nodes may exceed one frame.
- Negative / trade-offs: a list per node is a small allocation per node at load time, where a
  packed array would be one; the benchmark's first frame shows what that costs (Q-2).
- Negative / trade-offs: the store's lists are sparse after removals, and every reader has to
  skip a hole; a reader that forgets it reads a removed node as present.
- Follow-ups: bringing an existing node to the front, such as on selection, which a new rank would
  give; batching many additions into one call, should a host application add thousands at once.

## Enforcement

Each test below cites this ADR with `Verifies: ARCH-engine-edits-nested-graph`.

- **Edits against a scan:** a property test of `crates/engine/src/graph.rs` applies random
  sequences of additions, removals, and moves of nodes and edges to a graph and asserts after
  each step that a query and a hit test find exactly what a brute-force scan of the items in use
  finds, that no free slot is ever returned, and that the lists of edges at each node hold exactly
  the edges in use that end there. It also `Verifies: G-4`.
- **No rebuild per edit:** a test of `crates/engine/src/graph.rs` counts how often the index is
  built and asserts that adding and removing a node and an edge within the extent at 50,000 nodes
  builds it no time; replacing an edit by a rebuild turns it red. A second asserts that growing a
  graph of 100 nodes to 1,000 by additions inside its extent builds it again at each doubling and
  no more often.
- **Reuse:** a test asserts that the slot freed last is the slot the next addition of its kind
  takes, and that a slot past the highest is taken only when no slot is free.
- **Draw order:** a test of `crates/engine/src/graph.rs` adds a node into a freed slot below
  others, overlapping them, and asserts that a query returns it last and the hit test finds it;
  a browser test asserts that inspection draws it above the nodes it overlaps. Taking the highest
  slot instead turns both red. A second adds a container last, over nodes and over an edge, and
  asserts that a query returns it among the containers and below every other node, and that the
  hit test finds the nodes inside it first.
- **Containment:** a property test of `crates/engine/src/graph.rs` builds random trees of
  containers, moves containers and moves nodes into and out of them, and asserts after each step
  that every node's world position is the sum along its chain, that a query and a hit test find
  what a scan of the world positions finds, and that a move into a node it contains is refused.
  A test asserts that removing a container removes everything it contains and every edge at it,
  that a container's box does not grow when a node it holds moves past its outline, and that a
  load or an edit putting a node in a node that is no container is refused.
- **Border nodes in the order:** a test of `crates/engine/src/graph.rs` adds a node above an action
  with pins and moves the action into a container, and asserts that a query returns each pin
  directly after the action and the hit test finds a pin before the action.
- **Free slots refused:** a test of `crates/engine-wasm/src/lib.rs` names a freed slot in each
  export that takes slots and asserts the refusal of a slot beyond the graph.
