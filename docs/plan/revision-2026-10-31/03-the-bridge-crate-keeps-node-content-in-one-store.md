# Ticket: The bridge crate keeps node content in one store

## What to build

`Engine` in `crates/engine-wasm/src/lib.rs` keeps node content in three fields of its own
(lines 407–413): `content`, the load's, `edited`, a map of each slot an addition or a patch gave
content, and `content_units`, the count the budget holds across edits (ADR-0013, *Limits*). The
lookup "the edited content of a slot, else the load's" is written out five times (lines 594, 860,
875, 916, 940), the count is moved by hand in `add`, `update`, and `remove_nodes`, and the units
are counted twice: by the check's `Cursor` for a load, and again by `ContentData::units_of`
(`crates/engine-wasm/src/graph_data/content.rs:809`) for an edit, since `checked_content`
(`crates/engine-wasm/src/graph_data.rs:1859`) drops the cursor's count. The invariants of the
content and its budget live in the WebAssembly facade.

A type in `crates/engine-wasm/src/graph_data/content.rs` owns the load's content, the edited
content, and the count: it answers a slot's content, and adds, replaces, and removes a node's
content while keeping the count; the check returns the units it counted, and nothing counts them
again. `Engine` holds one field of it.

## Acceptance criteria

- [ ] Given `crates/engine-wasm/src/lib.rs`, when an export needs a node's content or the count,
      then it asks the store, and no other code of the crate matches on `edited`.
- [ ] Given the property test of loads and edits that checks the count after every step, when it
      runs, then it passes unchanged.
- [ ] Given the bridge's tests and the browser tests of the content budget, when they run, then
      they pass unchanged.
- [ ] Broken once: with the store's removal leaving a node's units in the count, the property
      test fails.

## Read first

- ADR-0013 (*Limits*), ADR-0034, ADR-0022; `crates/engine-wasm/src/lib.rs` (`Engine`, `add`,
  `update`, `remove_nodes`, `lay_out_heights`, `lay_out_found`, `hit`),
  `crates/engine-wasm/src/graph_data/content.rs` (`ContentData`).

## Blocked by

- docs/plan/revision-2026-10-31/02-a-nodes-height-is-computed-once-by-the-engine.md

## Mode

with the human: `crates/engine-wasm/` is a protected part of ADR-0007.
