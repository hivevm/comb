# Ticket: The bridge crate's graph data split by concept

## What to build

`crates/engine-wasm/src/graph_data.rs` is 5,032 lines, its module doc "the reading and checking
of graph data", and holds about eight concepts and 2,900 lines of tests: limits and lenient field
readers (1–180), the wire types (180–405), node columns and the decoding of string columns
(405–770), edge columns and codes (770–1080), `GraphDataProblem` (1083–1336), reading items
(1339–1517), the checks of nodes and edges (1519–1812), loads and `addNode` (1814–1893), the
edits of edges and the node patch (1895–2171), and the tests' column builders (2173–2632).
`crates/engine-wasm/src/graph_data/content.rs`, 1,848 lines, holds codes and limits, the check of
content columns, storage and string indexing, the adapter to the engine's layout and hit test, the
buffers of what is drawn (`Drawn`, `draw`), the output of `content_of`, and a serde reader whose
"no list, no object" visitor tail is written three times (`RowSeed`, `ElementVisitor`,
`TrendVisitor`) and whose `Lenient<T>` repeats `Field<T>` of `graph_data.rs`. Decoding string
columns is split between the two files (`string_at`, `ascii_at` beside `value_at`, `values`,
`spans`; `runs_fit` repeating `bounds_fit`).

Split both along those concepts, the tests with the code they test, as `crates/engine/src/graph`
was split; a wide mechanical refactor, in steps each green. The buffers of what is drawn leave
`graph_data`, which reads and checks.

## Acceptance criteria

- [ ] Given `crates/engine-wasm/src/graph_data.rs` and `crates/engine-wasm/src/graph_data/`,
      when the split lands, then each module holds one of the concepts above, string columns are
      decoded in one module, and the serde visitors' tail and the lenient field are written once.
- [ ] Given `cargo test` and the property tests of `crates/engine-wasm`, when they run, then they
      pass with the same tests, moved, none removed.
- [ ] Given `docs/ARCHITECTURE.md`, when the split lands, then the bridge's entry names the
      modules.

## Read first

- ADR-0034, ADR-0028; the overview's **Bridge** entry; the split of `crates/engine/src/graph`
  under `graph/` as the golden path.

## Blocked by

- docs/plan/revision-2026-10-31/04-the-query-places-at-middle-only-what-middle-draws.md

## Mode

with the human: `crates/engine-wasm/` is a protected part of ADR-0007.
