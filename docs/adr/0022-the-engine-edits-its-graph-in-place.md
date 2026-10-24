# ADR-0022: The engine edits its graph in place, one node or edge at a time, reuses freed slots, and draws a node added last on top

- **Status:** 🟡 proposed
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** `crates/engine/src/graph.rs`, `crates/engine/src/spatial.rs`, the exports of `crates/engine-wasm` that add and remove nodes and edges, the order in which `packages/comb/src/render/` binds node views and particles, and the map from identifiers to slots and the per-slot lists of `packages/comb/src/store/`

## Context

G-1, G-3, and G-4 ask for nodes and edges to be added and removed one by one: the host
application adds a node or an edge, the user connects two nodes or deletes the selection. Today
the engine knows only a whole graph. `Graph::new` builds the node and edge buffers, the lists of
edges at each node as one packed array (`offsets` and `incident`), and both grids of the spatial
index, each sized for the items it was built with. Nothing can be added or taken out of them;
the only way to change the graph's structure is `load`, which builds all of it again.

Q-1 asks for 60 fps with 50,000 nodes and 50,000 edges. A load of that graph takes a good part of
Q-2's second, so an edit that reloads costs that much per edit, and a host application that adds
nodes in a loop pays it each time. A frame of 16.7 ms has no room for it.

A slot is the index of a node or an edge in the engine's buffers, the same on both sides of the
bridge (ADR-0010). The shell keeps the map from identifiers to slots, and every call into the engine
after a load names slots (ADR-0010, *Slots*). ADR-0010 leaves open when slots are compacted after
deletions. Removing an item leaves its slot empty; what fills it decides whether slots stay dense,
whether the buffers grow with every edit, and in what order nodes are drawn, since the scene draws
in slot order and the hit test takes the node in the highest slot as the one on top (ADR-0012). A
node the host application adds has to come to the front, where the user dropped it, also when it
takes a freed slot below others.

This conflicts with the letter of ADR-0012 (*Culling*), which is accepted: it binds the pooled
display objects to the slots a query found "in slot order". Edges and edge labels keep that
order; node views and particles would be bound in the order of the nodes' ranks below. The
maintainer decides it before this ADR is accepted, by superseding ADR-0012 with that clause
narrowed to edges and labels, or otherwise.

The spatial index is a uniform grid over the extent it was built for; items beyond the extent
fall into its border cells, it counts them, and it is built again once more than an eighth of the
items, and at least 16, lie beyond (`Graph::translate`). An item that would cover more than 64
cells lives in an overflow list every query scans.

## Decision

We will edit the engine's graph in place, one node or edge at a time: an addition takes the most
recently freed slot of its kind, or a new slot after the last, a removal frees its slot and takes
the item out of the spatial index and out of the lists of edges at its nodes, no edit builds the
graph again, nor its index beyond the rule that rebuilds it after growth and moves, and every node
carries a rank that orders drawing and hitting, a node added taking the highest.

- **Free slots:** the engine keeps a list of free slots for nodes and one for edges, last freed
  first out. An addition pops from it, or appends a slot after the highest when it is empty. The
  engine chooses the slot and returns it; the shell records it. A load empties both lists and
  numbers slots from 0 as before, so a load still gives node `i` and edge `i` slot `i`.
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
- **Draw order of nodes:** the engine keeps a rank per node slot, a `u32`. A load ranks node `i`
  as `i`, as slot order is today; each node added takes the next rank, one above the highest
  given, so it is drawn above every other node whatever its slot. A query returns the node slots
  it found in ascending rank, and the shell binds node views and particles in the order it
  returns them, so the last bound is drawn on top. The hit test of nodes takes, of the nodes that
  hold the point, the one of the highest rank: what is drawn on top is hit first. Where the next
  rank would pass `u32::MAX`, the engine first renumbers the ranks in use from 0 in their order,
  once per four billion additions. Edges and edge labels keep slot order.
- **The limits of a load** (ADR-0026) hold after every edit: the slots in use of each kind stay
  within the limit, and because a free slot is taken before a new one, so does the highest slot.
- **The shell's side:** the map from identifiers to slots drops the identifier of a removed item
  and gains that of an added one with the slot the engine returned. The store's per-slot lists of
  nodes and edges hold no entry at a free slot; every reader of them skips such a hole, as the
  scene already reads only the slots a query returns. A selection that names a removed item is
  cleared.

**Out of scope:** compacting slots between loads, which this decision makes unnecessary; adding
or removing many items as one batch, beyond removing a node's edges with it; undo, which the host
application owns (ADR-0011).

## Alternatives considered

- **Reload per edit** — no new code in the engine, and every edit is exactly a load, but an edit
  then costs what a load costs, against Q-1 at 50,000 nodes.
- **Append only, removed slots left as holes** — a new node always takes the highest slot, so it
  is drawn on top, but every addition grows the buffers and the grids for good. A session that
  adds and removes reaches the limit of 1,000,000 slots without holding as many items, and needs
  the compaction ADR-0010 leaves open, which renumbers slots under the shell's map.
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
- **A packed list of edges per node, rebuilt on an edit** — the layout `Graph::new` has today; an
  edit would rebuild it in time linear in the edges, the cost this decision avoids.

## Sources / Prior art

- The slot map and the generational arena, which reuse freed slots through a free list: the
  `slotmap` crate — <https://docs.rs/slotmap>; and Catherine West, *Using Rust for game
  development* (RustConf 2018) — <https://kyren.github.io/2018/09/14/rustconf-talk.html> (both read
  2026-10-24). This
  decision keeps the free list without generations, because the shell's map from identifiers is
  the one source of names, and every name is checked against it before a slot crosses.
- `Graph::new`, `Graph::translate`, and `Grid` in `crates/engine` as they stand (read on
  2026-10-24).

## Consequences

- Positive: an edit costs time in the number of edges at the nodes it touches and the cells their
  bounds cover, plus the overflow list the removal searches, not in the size of the graph, which
  serves Q-1.
- Positive: slots stay as dense as the graph is large; buffers grow only with the graph.
- Positive: a load stays what it is, so Q-2 and every test of a load keep their meaning.
- Positive: a node the host adds appears on top, where the user dropped it, and is hit first.
- Negative / trade-offs: a query sorts the node slots it found by rank, `k log k` for `k` found,
  where it sorted by slot before at the same cost; the engine keeps four bytes more per node.
- Negative / trade-offs: node order and slot order part after the first addition, so a test or a
  reader that takes the highest slot for the top node is wrong from then on.
- Negative / trade-offs: the frame in which a rebuild for growth or moves falls costs what the
  index of a load costs, which at 50,000 nodes may exceed one frame.
- Negative / trade-offs: a list per node is a small allocation per node at load time, where the
  packed array was one; the benchmark's first frame shows what that costs (Q-2).
- Negative / trade-offs: the store's lists are sparse after removals, and every reader has to
  skip a hole; a reader that forgets it reads a removed node as present.
- Follow-ups: the conflict with ADR-0012 above; bringing an existing node to the front, such as
  on selection, which a new rank would give; batching many additions into one call, should a host
  application add thousands at once.

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0022`.

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
  slot instead turns both red.
- **Free slots refused:** a test of `crates/engine-wasm/src/lib.rs` names a freed slot in each
  export that takes slots and asserts the refusal of a slot beyond the graph.
