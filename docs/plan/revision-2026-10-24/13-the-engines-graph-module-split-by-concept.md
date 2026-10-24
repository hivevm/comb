# Ticket: The engine's graph module is split by concept, and its slots are kept once

## What to build

`crates/engine/src/graph.rs` is 2,215 lines: slot bookkeeping (free lists, ranks), the edges and
the lists at each node, the upkeep of the spatial index, the hit test, the labels, and the query,
with its tests. Within it, the free-slot allocator of ADR-0022 is written twice, once per kind
(`node_slots`/`edge_slots`, `free_nodes`/`free_edges`, the pop-or-append of `add_node` and
`add_edge`, the freeing of `remove_nodes` and `free_edges_at`), and the two disagree on overflow:
a node past the limit is `GraphError::TooManySlots`, an edge `SlotError::NoEdge`. The rule that
rebuilds the index (ADR-0022, *The spatial index*) is checked at seven call sites. `add_edge`
computes an appended edge's placement twice and copies `place_edge` inline, because the grid has
two doors, `set`, which ignores an item beyond its records, and `add`, which grows them. The
private `hit` is the node hit beside `hit_at`.

Split `graph.rs` into modules by concept under `graph/`, as `graph/budget.rs` already is, each with
its tests; keep the free slots of a kind in one type used twice; call the rebuild rule from one
function after every edit; let `add_edge` place its edge through `place_edge`; name the node hit
`node_at`. Interface-preserving: the bridge crate sees the same functions.

## Acceptance criteria

- [ ] Given the engine's tests, the property tests against a scan, the budget's property test, and
      the count of index rebuilds, when they run, then they pass unchanged.
- [ ] Given an edge added past the limit of a load, when the engine refuses it, then it refuses it
      as it refuses a node past it, with one error kind.
- [ ] Given the rule that rebuilds the index, when it is read, then one function holds it.
- [ ] Given `cargo mutants` over `crates/engine`, when it runs, then `scripts/check-mutants.sh`
      passes with `mutants-missed.txt` updated by file only where code moved.

## Read first

- ADR-0022 (*Free slots*, *The spatial index*, *Draw order*), ADR-0025, ADR-0027, ADR-0028 (*Core*).
- `crates/engine/src/graph.rs`, `crates/engine/src/spatial.rs`, `crates/engine/src/graph/budget.rs`,
  `crates/engine/mutants-missed.txt`.

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine/src/graph.rs` and `graph/` are protected parts of ADR-0007.
