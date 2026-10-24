# Ticket: The bridge crate reads an edge one way, and names the shell's mistakes as such

## What to build

ADR-0028 makes `crates/engine-wasm/src/graph_data.rs` the one place that checks graph data, and
an added edge is to be checked "as a load checks one". The checks are written more than once:
the label of an edge in `edge_of` and again in `update_edge_in`; the `EdgeSpec` in `edges_of` and
in `add_edge_to`; the three identifier lengths in `ids_of` and in `add_edge_to`. In
`crates/engine-wasm/src/lib.rs` the check of the screen pixel stands in `hit` and again in `query`,
and `hit` lacked it until review. A slot that holds nothing is the shell's mistake, `SlotError` by
the crate's own rule, yet `add_edge_to` and `update_edge_in` turn it into a `GraphDataProblem` of
kind `malformed`, which the host would read as a fault of its data. The doc comments of `Hit` and of
the `hit` export name neither the connector nor the label.

Read each per-edge field through one function that load, `addEdge`, and `updateEdge` all call;
check the pixel in one function; throw `SlotError` for a slot that holds nothing from `addEdge` and
`updateEdge` as from the other exports; correct the two doc comments.

## Acceptance criteria

- [ ] Given the bridge crate's property tests, when they run, then an added edge and a patch are
      refused exactly as a load of the edge they make, as today.
- [ ] Given `addEdge` or `updateEdge` handed a free slot, when it runs, then it throws a
      `SlotError`, not a `GraphDataError`; a Bun test of the bridge decides it.
- [ ] Given the label, the spec, and the identifier lengths of an edge, and the screen pixel, when
      the code is read, then each is checked in one function.
- [ ] Broken once: with the label's check dropped from the one function, the property test fails
      for load, add, and update alike.

## Read first

- ADR-0028 (*Bridge*), ADR-0010, ADR-0023 (*Validation*), ADR-0025.
- `crates/engine-wasm/src/graph_data.rs`, `crates/engine-wasm/src/lib.rs`,
  `crates/engine-wasm/src/properties.rs`, `packages/comb/src/bridge/bridge.test.ts`;
  `docs/CONVENTIONS.md` (*Check a value as the engine keeps it*).

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine-wasm/` is a protected part of ADR-0007.
