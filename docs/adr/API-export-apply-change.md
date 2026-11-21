# API-export-apply-change: Comb exports the function that applies a change to the host application's copy of the graph

- **Status:** 🟡 proposed
- **Date:** 2026-11-07
- **Deciders:** Markus Brigl
- **Applies to:** the exports of `packages/comb/src/index.ts`, the change types and the patch merge of `packages/comb/src/api/`, and every host application that keeps a copy of the graph from `onChange`, `examples/metric-tree/src/main.ts` and `examples/uml/src/diagram.ts` among them

## Context

The specification leaves persistence to the host application
([Non-Goals](../SPECIFICATION.md#non-goals)), and
[API-edits-report-nested-changes](API-edits-report-nested-changes.md) has Comb apply each edit at
once and tell the host application every change as a typed `GraphChange` through one listener,
so that a host that persists keeps its own copy of the graph from `onChange` alone. The convention
*A host application's copy follows what Comb took* asks that such a copy be written only from what
Comb tells.

Both examples keep such a copy, and both write the same code for it, which
[ARCH-one-workspace-per-example](ARCH-one-workspace-per-example.md) keeps them from sharing:

- `patched`, which merges an `EdgePatch` into an edge as Comb merges it, `null` clearing a dash
  or a label, is the same function, comment included, in `examples/metric-tree/src/main.ts` and
  `examples/uml/src/diagram.ts`;
- the table `MIRROR` of one handler per kind of change, typed so that the type checker fails it
  where a kind is left out, and `removed`, which drops the nodes and edges a removal names, are the
  same in both, each example adding its own records beside them.

How a patch merges, which fields `nodeUpdated` and `edgeUpdated` carry, and that a removal of
nodes names the edges it took with them are Comb's rules. A host application writes them a second
time from the documentation, and a change of the merge, such as a further field that `null`
clears, reaches its copy only where its author reads the change. As with the heights that
[REN-node-content-and-hits](REN-node-content-and-hits.md) answers by `heightOf`, the copied
rule is a public interface nobody declared. The design revision of 2026-11-07, which closed the
state-diagram feature, found the two copies in its survey of `examples/`.

xyflow, which API-edits-report-nested-changes names for the controlled data flow, exports
`applyNodeChanges(changes,
nodes)` and `applyEdgeChanges` for the same need, returning the nodes with the changes applied.

Open questions: which goal this serves, since no `G-n` or `Q-n` names a host's copy and Q-3 asks
for a fully typed public interface; whether the function belongs to the entry `comb` or to one of
its own; and whether it changes the copy in place.

## Decision

We will export from `comb` a function `applyChange(graph, change)`. It applies one `GraphChange`
to the host application's `GraphData`, in place, as Comb applied it. It handles every kind of
change that API-edits-report-nested-changes lists:

- `loaded` changes nothing.
- `nodeAdded` and `edgeAdded` copy the node or the edge in.
- `nodeUpdated` and `edgeUpdated` merge the patch as Comb merges it.
  - `null` clears an edge's dash or labels.
  - A border node takes `side` and `offset`.
  - A patch may give `regions`. A region it leaves out goes from the copy, as Comb removed it.
    Everything the region holds goes with it, with their border nodes and every edge at any of
    them.
- `nodeMoved` sets the node's `x`, `y`, and `container`, or a border node's `side` and `offset`.
- `nodeResized` sets the node's `x`, `y`, `width`, and `height`. It sets `x` and `y` of each node
  `moved` names, and the size of each region `regions` names.
- `regionsMoved` sets the size of each region `regions` names, and `x` and `y` of each node `moved`
  names.
- `nodesRemoved` and `edgesRemoved` drop the nodes and the edges they name.
- `labelMoved` sets the label's `t` and `offset`.

The function obeys these rules:

- It needs no `Comb` and no engine. A host application calls it inside its listener, on its own
  copy, before and after `destroy` alike.
- It copies what it takes from a change. The copy never shares an object with the store (the
  convention *Hand the host copies*).
- A change naming a node, a region, an edge, or a label the copy does not hold changes nothing for
  that item.
- The change that adds a kind of `GraphChange` or a field of a patch extends the function to it.

**Out of scope:** what a host application keeps beside the graph, such as the UML example's kinds
and classifiers, which it still updates from the same change; applying several changes at once;
undo; persisting the copy anywhere.

## Alternatives considered

- **Each host application writes its own copy of the rules** — today's state; no interface, and
  every host repeats the patch merge and the removal, held to Comb only by its own tests.
- **Return a new `GraphData`**, as xyflow's helpers return a new array — suits a host application
  that keeps its graph immutable, but copies the lists of 50,000 nodes (Q-1) for every change, and
  both examples change their copy in place today.
- **Comb hands out its whole graph on request** (`comb.graph()`) — no copy to keep, but a host
  that persists after each change would read the whole graph each time, and the store keeps no
  coordinates ([ARCH-graph-in-zustand-store](ARCH-graph-in-zustand-store.md)), so each read gathers
  them from the engine.
- **A shared module the examples import** — the least code, but ARCH-one-workspace-per-example keeps
  each example a
  workspace that imports no other, and a host application outside the repository would still
  write the rules itself.

## Sources / Prior art

- xyflow's `applyNodeChanges(changes, nodes)`, which "take[s] an array of these changes and
  appl[ies] them to your nodes" and returns an array of nodes —
  <https://reactflow.dev/api-reference/utils/apply-node-changes>, read 2026-11-07. Whether it
  mutates its input was not confirmed from the page; its example passes the result to a state
  setter.
- The two copies in this tree: `patched`, `removed`, and `MIRROR` in
  `examples/metric-tree/src/main.ts` and `examples/uml/src/diagram.ts`.

## Consequences

- Positive: a host application keeps its copy from `onChange` with one call, and a change of how
  Comb merges a patch reaches every copy through the function.
- Positive: the two examples lose their copies of the rules, and each keeps only its own records.
- Negative / trade-offs: one more export of the public interface, which every new kind of change
  and every new field of a patch keeps; an in-place function does not suit a host that keeps its
  graph immutable, which copies first.
- Follow-ups: the examples call it, and the convention *A host application's copy follows what
  Comb took* can then point to it.

## Enforcement

A test of `packages/comb/src/api/` cites `Verifies: API-export-apply-change`. It drives an edit of
every kind of `GraphChange`, by the host application and by the user. The edits include:

- `null` clearing a dash and a label;
- a node moved into a container and out of it, and a border node moved along a side;
- a resize at the left that moves the nodes the node holds, and a resize that changes region sizes;
- a drag of a region's line;
- a patch of `regions` that leaves out a region holding nodes, border nodes, and edges.

After each edit, the test asserts that a copy kept by `applyChange` from `onChange` alone equals the
graph Comb holds, field by field. It asserts that a change naming an item the copy does not hold
leaves the copy as it was.
