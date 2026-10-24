# Ticket: The example mirrors every change of the graph in one place

## What to build

The example keeps its own copy of the graph for its sidebar from what `onChange` tells
(`examples/metric-tree/src/main.ts`), as a host application that persists would. It handles
`nodeAdded`, `edgeAdded`, the removals, `edgeUpdated`, and `labelMoved`, but not `nodeMoved`, so
a moved node's position goes stale in the copy, and not `nodeUpdated`: the title is written into
the copy by the sidebar's input handler instead, so nodes and edges follow two paths. `patched()`
re-implements Comb's merge of an edge patch beside it.

Mirror every kind of `GraphChange` in one function of the example, the title following
`nodeUpdated` as an edge follows `edgeUpdated`, so that the example shows a host how to keep a copy
from `onChange` alone (ADR-0023).

## Acceptance criteria

- [ ] Given a node dragged, retitled, and its edge restyled, when the example's copy is read in a
      browser test, then it holds the node's new position, title, and the edge's new attributes.
- [ ] Given `main.ts`, when it is read, then one function handles every kind of `GraphChange`, and
      the type checker fails it where a kind is left out.
- [ ] Given the browser tests, when they run, then they pass.

## Read first

- ADR-0023 (*Changes*, *Delivery*); `examples/metric-tree/src/main.ts`;
  `examples/metric-tree/e2e/select-edge.spec.ts`, `drag.spec.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended: `examples/metric-tree/src/` is no protected part of ADR-0007. A browser test decides
the criteria, the scope is the example's copy of the graph, and a wrong result costs one revert,
noticed by a red browser test and undone by the revert. Stop: if a change of `comb` itself seems
needed, or after two attempts, hand off with the state written here.
