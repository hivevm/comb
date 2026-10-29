# Ticket: A string column crosses in pieces, so that a load at the limit of ADR-0028 loads

## What to build

A load within every limit of ADR-0028 loads again in every evergreen browser. Today a column of
titles or of label texts crosses as one JavaScript string, and 600,000 nodes with titles of 1,000
UTF-16 code units, or 600,000 edges with label texts of 1,000, pass V8's maximum string length
of about 2^29 code units: the join in `packages/comb/src/bridge/index.ts` (`joined`) throws a
`RangeError`, and the load is refused as malformed.

- **The writer.** Each string column of `NodeColumns` and `EdgeColumns`, the identifiers, the
  titles, the sources, the targets, and the label texts, crosses as a list of pieces, each one
  string of at most 2^28 code units that ends where a value ends, beside the `Uint32Array` of
  boundaries it has today, which counts across all pieces. The bound on a piece is a parameter of
  the writer, so that a test can cut with a small one; the snapshot passes 2^28. A column whose
  values fit in one piece crosses as one, and a column of no code units as none.
- **The bridge crate.** `loadGraph` in `crates/engine-wasm/src/lib.rs` takes each string column as
  `Vec<String>` of pieces. `crates/engine-wasm/src/graph_data.rs` checks that the pieces' lengths
  sum to the last boundary and that each piece ends on a boundary, and refuses either as malformed;
  it maps the identifiers' boundaries piece by piece, still only after every length is checked.
  Every other rule, its order, and every refusal's kind and names stay as they are.

ADR-0033 decides this (*Graph data of a load*). Once this lands, the markers that cite
`ADR-0033` hold for it; the maintainer accepts ADR-0033 after reviewing this change.

## Acceptance criteria

- [ ] Given a column cut with a bound of 16 code units, values of 0 to 16 units among them,
      values outside the Basic Multilingual Plane, and an empty column, when the writer cuts it,
      then every piece holds at most 16 units and ends on a boundary, and a load of it reads every
      value back exactly; a test in `packages/comb/src/bridge/bridge.test.ts` cites
      `Verifies: ADR-0033`.
- [ ] Given pieces whose lengths do not sum to the last boundary, and a piece that ends inside a
      value, when they are loaded, then each is refused as malformed and the engine keeps working;
      tests in `crates/engine-wasm/src/graph_data.rs` cite `Verifies: ADR-0033`.
- [ ] Given 600,000 nodes with titles of 1,000 code units, and 600,000 edges with label texts of
      1,000 code units, when each is loaded through the public interface in Chromium, then both
      load; a browser test in `examples/metric-tree/e2e/malformed.spec.ts` cites
      `Verifies: ADR-0033`.
- [ ] Given the property test of `crates/engine-wasm/src/properties.rs`, when it generates a load,
      then its string columns cross in pieces of a bound it generates too, and the bridge crate
      refuses exactly what the oracle refuses.
- [ ] Given the type test `packages/comb/src/bridge/snapshot-only.test.ts`, when `tsc` checks it,
      then its pin of `loadGraph`'s generated parameter types names each string column as
      `string[]`.
- [ ] Given the timing of the load's steps on `metricTree(3334)` in headless Chromium, 25 cold
      runs against `main` in the same session, when it runs, then no step's median grows by more
      than 1 ms.
- [ ] Given `scripts/check-bundle.sh`, when it runs, then the bundle stays within Q-3.

## Read first

- `docs/plan/first-frame/spec.md`.
- ADR-0033 (*Context*, *Graph data of a load*, *Enforcement*), ADR-0028 (*Bridge*, the limits),
  ADR-0007 (protected parts), ADR-0002 (markers).
- `packages/comb/src/bridge/index.ts` (`joined`, `nodeColumns`, `edgeColumns`),
  `crates/engine-wasm/src/graph_data.rs` (`bounds_fit`, `values`, `count`, `value_at`),
  `crates/engine-wasm/src/lib.rs` (`load_graph`).

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes protected parts of ADR-0007 (`crates/engine-wasm/`,
`packages/comb/src/bridge/`), and it implements ADR-0033 while it is proposed.
