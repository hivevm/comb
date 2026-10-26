# Ticket: The bridge crate checks each field of a load as it reads it, without a second copy

## What to build

A load reaches its first frame sooner because the bridge crate no longer copies every field of
the batch before it checks it. Today `graph_of` in `crates/engine-wasm/src/graph_data.rs` first
builds `batch_of`'s checked copy of every node and edge, unwrapping each `Field<T>`, and only then
reads that copy in `ids_of`, `nodes_of`, and `edges_of`. The CPU timing of a load of 50,010 nodes
and edges puts that copy at about 5 ms of `loadGraph`.

Read each field where `nodes_of` and `edges_of` (and `ids_of`) use it, and drop the intermediate
copy. The refusal a load names must stay the one it names today: a field missing or of another
type is named before any other refusal of the batch, wherever it stands, because the batch is
read whole before it is checked. The flag that `reading` already keeps, whether any field was
refused, tells whether that search is needed at all; the simplest form that keeps the order wins,
and the pull request says which it chose.

This is a refactoring within ADR-0028 and ADR-0032: no format, rule, kind, or message changes.

**The timing.** The steps of a load, `snapshotOf` of `packages/comb/src/api/snapshot.ts`,
`loadGraph` of `packages/comb/src/bridge/index.ts`, and the store's `load` of
`packages/comb/src/store/index.ts`, on the benchmark's graph (`metricTree(3334)` of
`examples/metric-tree/src/graph.ts`, 50,010 nodes and edges), in headless Chromium without a GPU,
each run in a fresh page, 25 runs, the median of each step, this branch and `main` built and timed
in the same session on the same machine. The harness lives under `.scratch/`; its numbers go into
the pull request.

## Acceptance criteria

- [ ] Given the suites of `crates/engine-wasm/src/graph_data.rs`, `crates/engine-wasm/src/lib.rs`,
      and the property test of `crates/engine-wasm/src/properties.rs`, when they run unchanged,
      then they pass: every refusal, its kind, its names, and the first one a load names stay as
      they are.
- [ ] Given a batch whose first node has a coordinate that is not finite and whose last edge has a
      field of another type, when it is loaded, then the load names the edge's field, as today; a
      test pins it if none does yet.
- [ ] Given the timing, when this branch and `main` are timed in the same session, then
      `loadGraph`'s median falls by at least 2 ms and no other step's grows.
- [ ] Given the pull request, when it opens, then it names `batch_of` gone and its timing.

## Read first

- ADR-0028 (*Bridge*, *What the bridge cannot see*), ADR-0032 (*Errors*, *Graph data of a load*),
  ADR-0024 (*Graph data*), ADR-0007 (protected parts).
- `crates/engine-wasm/src/graph_data.rs`: `Field`, `reading`, `items`, `batch_of`, `nodes_of`,
  `edges_of`, `ids_of`, `graph_of`.
- The oracle of `crates/engine-wasm/src/properties.rs`, which decides the order of refusals.

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine-wasm/` is the validation of graph data, a protected part of
ADR-0007, and the effect is decided by a timing, not by a test.
