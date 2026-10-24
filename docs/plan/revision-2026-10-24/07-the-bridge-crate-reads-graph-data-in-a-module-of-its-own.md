# Ticket: The bridge crate reads graph data in a module of its own

## What to build

`crates/engine-wasm/src/lib.rs` is about 1,200 lines outside its tests and holds two concepts:
the reading and checking of graph data (the limits, the lenient `Field` and `Text` readers, the
input types, `GraphDataProblem`, `node_of` to `graph_of`, `NodePatch` and `patch_of`, about 880
lines) and the WebAssembly exports (`Engine`, the free check functions, the query's enums, the
trap of test mode). ADR-0009 makes the bridge crate the one place that validates graph data; that
place is the first two thirds of one file, read by every change to an export, and the property
test (`properties.rs`) and the unit tests test both halves from one `mod tests`.

Move the reading and checking of graph data into a module of the crate (`graph_data.rs`, or a
name from the glossary), with its unit tests beside it, and keep `lib.rs` to the exports and
their conversions. Nothing exported changes: the generated `engine.d.ts` is byte for byte the
same.

## Acceptance criteria

- [ ] Given the crate, when it is built, then `packages/comb/wasm/engine.d.ts` and `engine.js`
      are the same as before the move.
- [ ] Given `cargo test --workspace` and the Bun and browser tests, when they run, then every test
      passes unchanged in what it asserts; the tests of the reading move with it.
- [ ] Given `lib.rs`, when it is read, then it holds the exports and their conversions, and no
      reader of graph data.

## Read first

- ADR-0009 (*Bridge*), ADR-0010 (*Structured data*, *Errors*).
- `crates/engine-wasm/src/lib.rs`, `crates/engine-wasm/src/properties.rs`.

## Blocked by

- docs/plan/revision-2026-10-24/02-a-patch-field-is-named-as-the-host-wrote-it.md
- docs/plan/revision-2026-10-24/03-every-narrowing-to-f32-says-why.md

## Mode

with the human: `crates/engine-wasm/` is a protected part of ADR-0007.
