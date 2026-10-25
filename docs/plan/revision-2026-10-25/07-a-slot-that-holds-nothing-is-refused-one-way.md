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

Handed off before any change, at the stop of the *Mode*: the first criterion asks `translate` to
refuse a free slot with `SlotError`, and today the bridge throws `TranslateError`
`{ kind: "slotOutOfRange", slot }` for it. The kind the shell sees changes, to `noNode`, and so
must four existing assertions:

- `packages/comb/src/bridge/bridge.test.ts` (the test of free slots): `bridge.translate` on a free
  slot expects `{ kind: "slotOutOfRange", slot: 2 }`.
- `crates/engine-wasm/src/lib.rs`, the test of a freed slot refused by every export that takes
  slots: expects `Err(TranslateError::SlotOutOfRange { slot })`.
- `crates/engine/src/graph/tests.rs`: expects `Err(PositionError::SlotOutOfRange { slot: 3 })` of
  `Graph::translate`.
- `crates/engine/src/positions.rs`: its own test of the range check, which folding the module into
  the node edits makes unreachable code, so the assertion goes with it.

No shell code reads the kind: `interaction/node-drag.ts` calls `bridge.translate` without a catch,
on slots the store holds, and `checked()` of `api/editors.ts`, which tells `noNode` and `noEdge`
apart, never wraps `translate`. `TranslateError` would keep `nonFiniteDelta` only, or `translate`
would throw `SlotError` for a slot and `TranslateError` for a delta.

To decide: whether the four assertions may change as the criterion implies, and so the bridge's
format of `translate`'s refusal (ADR-0010, *Errors*); and whether `translate` then throws two types
or `TranslateError` carries `SlotError` as a variant.
