# Ticket: A load hands its edges to the engine as columns, and serde-wasm-bindgen converts nothing of a load

## What to build

The edges follow the nodes: the snapshot in `packages/comb/src/api/snapshot.ts` builds the
columns of the edges, the identifiers, sources, targets, and label texts each as one string with
a `Uint32Array` of UTF-16 boundaries; the colours, the label's `t`, `offset`, and background, and
the dash and gap as `Float64Array`, a background of another type as NaN, which its rule refuses as
`invalidBackground`; per label text a byte that says whether it is a text, so that one missing, of
another type, or with a lone surrogate is refused at its rule as `invalidLabelText`; the arrowhead
and the two sides as `Uint8Array` codes, a string that names none as its own code, which the first
pass refuses at its place; whether a label, its background, and a dash are present as
`Uint8Array`; and the position of the first value the first pass refuses, across nodes and edges,
a lone surrogate in an identifier, a source, or a target among them. The
`loadGraph` export of `crates/engine-wasm/src/lib.rs` takes only columns, and
`crates/engine-wasm/src/graph_data.rs` checks the edges by every rule it checks them by today, in
the same order, a side outside the four refused as `invalidField` naming the four. `GraphBatch`
and the reading of a load through serde-wasm-bindgen go; the edge of `addEdge` and the patch of
`updateEdge` keep crossing as serde types and reach the same check per rule.

The change that lands this ticket also deletes
`docs/plan/first-frame/01-the-bridge-checks-each-field-as-it-reads-it.md`, the fallback whose code
the columns replace.

The snapshot keeps filling in the defaults of an edge's colour, arrowhead, and sides before the
bridge (ADR-0024, ADR-0028).

## Acceptance criteria

- [ ] Given every refusal of an edge, each kind of `GraphDataProblem` an edge can cause, a field
      missing or of another type, a side outside the four, a missing end, a duplicate, an
      identifier of 257 UTF-16 code units, a label text of 1,001, a background and a colour that
      are no `0xRRGGBB`, a dash of three numbers, when it is loaded, then it is refused with the
      kind and the names it has today; tests in `crates/engine-wasm/src/lib.rs` and
      `examples/metric-tree/e2e/malformed.spec.ts` cite `Verifies: ADR-0032`.
- [ ] Given the property test of `crates/engine-wasm/src/properties.rs`, when it generates a load,
      then nodes and edges cross as columns, and the bridge crate refuses exactly what the oracle
      refuses.
- [ ] Given the type test `packages/comb/src/bridge/snapshot-only.test.ts`, when `tsc` checks it,
      then it pins the generated parameter types of the engine's `loadGraph` to the columns,
      strings and typed arrays, and a call that hands it a `GraphBatch` fails to compile; and
      `GraphBatch` no longer appears in the generated `packages/comb/wasm/engine.d.ts`.
- [ ] Given the timing of
      `docs/plan/first-frame/01-the-bridge-checks-each-field-as-it-reads-it.md`, when this branch
      and `main` are timed in the same session, then the median of the whole load path, the
      snapshot, `loadGraph`, the store's `load`, and the first query, falls by at least 30 ms
      against `main` with the nodes already in columns (about 45 ms expected: the edges' two
      thirds of the conversion's 79 ms, less the edge columns' copies), and `loadGraph`'s by at
      least 25 ms.
- [ ] Given the Benchmark workflow, run on demand on this branch until a run lands on an AMD
      EPYC 7763 (a run on another kind does not count either way), when that run compares, then
      the comparison passes and the median first frame lies at least 90 ms below the 480 ms of
      `main` before this plan; a run that misses it fails this criterion and is not repeated in
      the hope of a pass; the pull request links the run either way.
- [ ] Given `scripts/check-bundle.sh`, when it runs, then the bundle stays within Q-3.

## Read first

- `docs/plan/first-frame/spec.md`.
- ADR-0032 (all of it), ADR-0028 (*Bridge*, *Shell*), ADR-0024 (*Graph data*), ADR-0007
  (protected parts), ADR-0008 (*Benchmark*).
- `crates/engine-wasm/src/graph_data.rs` (`EdgeInput`, `edges_of`, `spec_of`, `add_edge_to`,
  `update_edge_in`), `packages/comb/src/api/snapshot.ts` (`edgeOf`, `labelOf`, `dashOf`),
  `.github/workflows/benchmark.yml`, `bench/compare.ts`.

## Blocked by

- docs/plan/first-frame/03-a-load-hands-its-nodes-over-as-columns.md

## Mode

with the human: it changes protected parts of ADR-0007 (`crates/engine-wasm/`,
`packages/comb/src/bridge/`, `packages/comb/src/api/`), and only the maintainer runs the Benchmark
workflow.
