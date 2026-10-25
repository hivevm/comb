# Ticket: A slot that holds nothing is refused one way, and an error names only what can happen

## What to build

ADR-0022 refuses a call that names a free slot "as a slot beyond the graph". The engine writes that
refusal several times, in two types: `Graph::translate` (`graph/nodes.rs`) refuses a free node slot
as `PositionError::SlotOutOfRange`, while `graph/edges.rs` and `graph/labels.rs` refuse the same
mistake as `SlotError`, each with a check of its own; the bridge mirrors both, `TranslateError`
beside `SlotError`. `positions::translate` (`crates/engine/src/positions.rs`) has one caller,
whose check before it makes its own range check unreachable, so the module holds little behind its
surface. And the error types are wider than what returns them: `Slots::take` and `add_node`
return `GraphError` where only `TooManySlots` can happen, and `AddEdgeError::Graph(GraphError)`
admits variants `add_edge` never produces, which the bridge still maps.

Check that the slots named hold an item in one function per kind, refuse with `SlotError` in every
export, fold `positions` into the module of the node edits, and narrow the error types to what each
function can return. The doc comment of `edge_ends` (`graph/edges.rs`), which says NaN only for a
slot beyond the loaded edges, names free slots too.

## Acceptance criteria

- [ ] Given every export that takes slots, when it is handed a free slot, then it throws the same
      `SlotError` kind (`Verifies: ADR-0022`), as the test of free slots in
      `crates/engine-wasm/src/lib.rs` asserts for each.
- [ ] Given the engine, when it is read, then the check that a slot holds a node is written once
      and once for an edge, and no function returns an error variant it cannot produce.
- [ ] Given `cargo test`, `cargo clippy`, `bun run test`, and `scripts/check-mutants.sh`'s list,
      when they run, then they pass, and the list of surviving mutants names no new survivor.

## Read first

- ADR-0022 (*Free slots*, *Enforcement*), ADR-0010 (*Errors*), ADR-0028 (*Core*).
- `crates/engine/src/positions.rs`, `graph/nodes.rs`, `graph/edges.rs`, `graph/labels.rs`,
  `graph/slots.rs`, `graph.rs` (`GraphError`, `AddEdgeError`); `crates/engine-wasm/src/lib.rs`
  (`TranslateError`, `SlotError`), `graph_data.rs` (their mapping).

## Blocked by

- None (can start immediately)

## Mode

unattended: the existing engine and bridge tests decide it, plus the mutants list; no part the
harness ADR keeps with the human (ADR-0007) is touched, and one revert undoes it. Stop: where the
shell would see another error than today for a call it makes, hand off, since `TranslateError` is
part of the bridge's data format (ADR-0010).

## Where it stands

The maintainer approved that `translate` refuses a free or out-of-range slot with `SlotError`
(`{ kind: "noNode", slot }`) and a delta that is not finite with `TranslateError`, narrowed to
`nonFiniteDelta`. That part has landed on the branch: the check that slots hold a node is written
once (`nodes_held`) and once for an edge (`edges_held`), `positions` is folded into
`graph/nodes.rs`, and the doc comment of `edge_ends` names free slots.

Handed off before the narrowing of the error types, at the stop the dispatcher set: narrowing
`Slots::take`, `add_node`, and `AddEdgeError` to `TooManySlots` changes five more assertions in
their type, not their value, beyond the four approved:

- `crates/engine/src/graph/slots.rs`: `slots.take()` expects `Err(GraphError::TooManySlots)`.
- `crates/engine/src/graph/tests.rs`: `slot(u32::MAX as usize + 1)` expects
  `Err(GraphError::TooManySlots)`.
- `crates/engine/src/graph/edges.rs`: `add_node` expects `Err(GraphError::TooManySlots)`, and
  `add_edge` `Err(AddEdgeError::Graph(GraphError::TooManySlots))`.
- `crates/engine-wasm/src/graph_data.rs`: `EdgeRefusal::from(AddEdgeError::Graph(...))` and
  `GraphDataProblem::from(GraphError::TooManySlots)`.

What the shell receives does not change: each still crosses as the same `GraphDataProblem`. To
decide: whether those assertions may change their types with the narrowing.
