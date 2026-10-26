# Ticket: A load hands its nodes to the engine as columns, refused as before

## What to build

**This ticket waits for ADR-0032 to be accepted.** It implements its clause *Graph data of a
load* for nodes; until the maintainer accepts the ADR (or tells the session to implement it while
it is proposed, AGENTS.md, section 3, rule 4), it is not started.

The tracer bullet through the columns: a host application's `load` hands the engine its nodes as
columns, end to end, and every refusal of a node stays as it is. The snapshot in
`packages/comb/src/api/snapshot.ts` builds, beside the node objects the store keeps, the columns
of the nodes: the identifiers and the titles each as one string with a `Uint32Array` of UTF-16
boundaries, `x`, `y`, `width`, and `height` as `Float64Array`, and the position of the first value
of the wrong type, a lone surrogate's `false` and an item that is no object among them.
`packages/comb/src/bridge/index.ts` hands them to the `loadGraph` export of
`crates/engine-wasm/src/lib.rs`, whose parameters type them, and
`crates/engine-wasm/src/graph_data.rs` checks them by the rules it checks a node by today, in the
same order, reading lengths off the boundaries and mapping the identifiers' UTF-16 boundaries onto
the string Rust holds. The edges still cross through serde-wasm-bindgen in this ticket, so
`loadGraph` takes the node columns and the edges.

The node of `addNode` keeps crossing as a serde type; it and a load's node reach one check per
rule in the bridge crate, so that the two cannot drift (ADR-0032, *Consequences*). The type test
`packages/comb/src/bridge/snapshot-only.test.ts` keeps refusing anything but what the snapshot
builds. The term *column* joins `docs/GLOSSARY.md`.

**The timing.** As in
`docs/plan/first-frame/01-the-bridge-checks-each-field-as-it-reads-it.md`: the steps of a load on
`metricTree(3334)` of `examples/metric-tree/src/graph.ts`, in headless Chromium without a GPU, 25
cold runs, medians per step, this branch and `main` in the same session; the harness under
`.scratch/`, its numbers in the pull request.

## Acceptance criteria

- [ ] Given every refusal of a node, each kind of `GraphDataProblem` a node can cause, a field
      missing or of another type, an item that is no object, a lone surrogate in an identifier and
      in a title, an identifier of 257 UTF-16 code units, a title of 1,001, a duplicate, a
      coordinate beyond the world's limit, when it is loaded, then it is refused with the kind and
      the names it has today; tests in `crates/engine-wasm/src/lib.rs` and
      `examples/metric-tree/e2e/malformed.spec.ts` cite `Verifies: ADR-0032`.
- [ ] Given the property test of `crates/engine-wasm/src/properties.rs`, when it generates a load,
      then its nodes cross as columns, a value of the wrong type at any position among them, and
      the bridge crate refuses exactly what the oracle refuses.
- [ ] Given identifiers and titles outside the Basic Multilingual Plane, when they are loaded,
      then the store and the engine hold them exactly; a test in
      `packages/comb/src/bridge/bridge.test.ts` cites `Verifies: ADR-0032`.
- [ ] Given the timing, when this branch and `main` are timed in the same session, then
      `loadGraph`'s median falls by at least 15 ms and the snapshot's grows by less than it falls.
- [ ] Given `scripts/check-bundle.sh`, when it runs, then the bundle stays within Q-3.

## Read first

- ADR-0032 (all of it), ADR-0028 (*Bridge*, *What the bridge cannot see*, *Shell*), ADR-0022,
  ADR-0007 (protected parts), ADR-0002 (markers).
- `crates/engine-wasm/src/graph_data.rs` (`NodeInput`, `checked_node`, `nodes_of`, `ids_of`,
  `graph_of`, `add_node_to`), `crates/engine-wasm/src/lib.rs` (`load_graph`),
  `packages/comb/src/bridge/index.ts` (`loadGraph`, `GraphSnapshot`),
  `packages/comb/src/api/snapshot.ts`, `packages/comb/src/api/editors.ts` (the load).
- The glue wasm-bindgen generates, `packages/comb/wasm/engine.js`, for how a string and a typed
  array cross.

## Blocked by

- docs/plan/first-frame/01-the-bridge-checks-each-field-as-it-reads-it.md
- docs/plan/first-frame/02-the-store-and-the-snapshot-read-a-load-once.md

## Mode

with the human: it waits for the maintainer to accept ADR-0032, and it changes the data format of
the bridge and the validation of graph data (`crates/engine-wasm/`, `packages/comb/src/bridge/`)
and `packages/comb/src/api/`, protected parts of ADR-0007.
