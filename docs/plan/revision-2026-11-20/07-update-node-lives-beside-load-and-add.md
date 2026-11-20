# Ticket: updateNode's work lives in the graph data module, and the export only converts

## What to build

A load and `addNode` live in `crates/engine-wasm/src/graph_data/load.rs`; `updateNode`'s work lives
in the export file, `crates/engine-wasm/src/lib.rs`: `update_with` (about 95 lines), `place_anew`,
`divide_anew` (about 75 lines), and `first_leaf`, while `add` reads the regions again for their
names. `divide_anew` drops what `move_into` and `place` return with `let _ =`. `lib.rs` holds about
2,270 lines that are no test.

Evidence: ticket 05 of uml-diagrams, rework a6fe8909 (decision A): a kept region divided anew lost
what it held; finding 7 of its first review: `updateNode` laid a grown node out from its grown
width, unlike a load.

Move `updateNode`'s work into a module of `graph_data` beside `patch_of`, so that `lib.rs` keeps the
conversion at the boundary, and let each failure of a graph mutation be a refusal or an
`unreachable!` that says why.

## Acceptance criteria

- [ ] Given the `updateNode` export of `lib.rs`, when it is read, then it converts its arguments,
      calls the module, and converts the answer, in about ten lines.
- [ ] Given the bridge crate, when it is searched, then no `let _ =` drops the result of a graph
      mutation.
- [ ] Given the tests of `updateNode` in `lib.rs`, when they move beside the new module, then they
      pass unchanged in their assertions.

## Read first

- Touches: `crates/engine-wasm/src/lib.rs`, `crates/engine-wasm/src/graph_data/edit.rs`,
  `crates/engine-wasm/src/graph_data/`
- API-bridge-columns-carry-nesting, API-edits-report-nested-changes.
- The seam: the bridge crate's tests.

## Blocked by

- docs/plan/revision-2026-11-20/05-the-engine-divides-a-node-in-one-operation.md
- docs/plan/revision-2026-11-20/06-a-node-rule-is-checked-in-one-place.md

## Mode

with the human: it touches the bridge crate, a protected part the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
