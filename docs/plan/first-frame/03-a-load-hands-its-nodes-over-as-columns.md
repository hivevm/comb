# Ticket: A load hands its nodes to the engine as columns, refused as before

## What to build

**This ticket waits for ADR-0032 to be accepted,** and ADR-0032 waits for the specification's
constraint on the bridge to change: it names serde-wasm-bindgen for structured data. The
maintainer lands that change first (AGENTS.md, section 3, rule 7), then decides ADR-0032; until
it is accepted, or the maintainer tells the session to implement it while it is proposed
(AGENTS.md, section 3, rule 4), this ticket is not started.

The tracer bullet through the columns: a host application's `load` hands the engine its nodes as
columns, end to end, and every refusal of a node stays as it is, in the order of the two passes
ADR-0032 (*Graph data of a load*) keeps. The snapshot in `packages/comb/src/api/snapshot.ts`
builds, beside the node objects the store keeps, the columns of the nodes:

- the identifiers and the titles each as one string with a `Uint32Array` of UTF-16 boundaries,
  and per title a byte that says whether it is a text, so that a title missing, of another type,
  or with a lone surrogate is refused at its rule as `invalidTitle`, not read as empty;
- `x`, `y`, `width`, and `height` as `Float64Array`;
- the position of the first value the first pass refuses: a `Field<T>` value missing or of
  another type, an identifier with a lone surrogate, which the snapshot hands over as `false`, or
  an item that is no object, refused as malformed.

`packages/comb/src/bridge/index.ts` hands them to the `loadGraph` export of
`crates/engine-wasm/src/lib.rs`, whose parameters type them, and
`crates/engine-wasm/src/graph_data.rs` checks them by the rules it checks a node by today, in the
same order. It reads every length off the boundaries and maps the identifiers' boundaries onto the
string Rust holds only after every identifier's length is checked: a value cut one code unit
beyond its limit may end in half a surrogate pair, and two such values side by side make one
character across their boundary. The edges still cross through serde-wasm-bindgen in this ticket,
so `loadGraph` takes the node columns and the edges; the first pass runs over both, nodes first.

The node of `addNode` keeps crossing as a serde type; it and a load's node reach one check per
rule in the bridge crate, so that the two cannot drift (ADR-0032, *Consequences*). The type test
`packages/comb/src/bridge/snapshot-only.test.ts` keeps refusing anything but what the snapshot
builds. The term *column* joins `docs/GLOSSARY.md`.

**The timing.** As in
`docs/plan/first-frame/01-the-bridge-checks-each-field-as-it-reads-it.md`, which describes it
whether or not that ticket is worked: the steps of a load on `metricTree(3334)` of
`examples/metric-tree/src/graph.ts`, in headless Chromium without a GPU, 25 cold runs, medians per
step, this branch and `main` in the same session; the harness under `.scratch/`, its numbers in
the pull request.

## Acceptance criteria

- [ ] Given every refusal of a node, each kind of `GraphDataProblem` a node can cause, a field
      missing or of another type, an item that is no object, a lone surrogate in an identifier and
      in a title, a missing title, an identifier of 257 UTF-16 code units, a title of 1,001, a
      duplicate, a coordinate beyond the world's limit, when it is loaded, then it is refused with
      the kind and the names it has today; tests in `crates/engine-wasm/src/graph_data.rs` and
      `examples/metric-tree/e2e/malformed.spec.ts` cite `Verifies: ADR-0032`.
- [ ] Given node 0 with `x: Infinity` and node 5 whose title holds a lone surrogate, when they are
      loaded, then the load is refused as `nonFiniteCoordinate` for node 0; and given a node
      without a title, then as `invalidTitle` for it; a test in
      `crates/engine-wasm/src/graph_data.rs` cites `Verifies: ADR-0032`.
- [ ] Given two identifiers side by side, each 300 code units long and cut by the snapshot so that
      the first ends in a high surrogate and the second begins with the low one, when they are
      loaded, then the load is refused as `idTooLong` for the first, and no boundary is mapped
      inside a character; a test in `packages/comb/src/bridge/bridge.test.ts` cites
      `Verifies: ADR-0032`.
- [ ] Given the property test of `crates/engine-wasm/src/properties.rs`, when it generates a load,
      then its nodes cross as columns, a value of the wrong type at any position among them, and
      the bridge crate refuses exactly what the oracle refuses.
- [ ] Given identifiers and titles outside the Basic Multilingual Plane, when they are loaded,
      then the store and the engine hold them exactly; a test in
      `packages/comb/src/bridge/bridge.test.ts` cites `Verifies: ADR-0032`.
- [ ] Given the timing, when this branch and `main` are timed in the same session, then
      `loadGraph`'s median falls by at least 15 ms (about 25 ms expected, a third of the
      conversion's 79 ms), and the snapshot's grows by less than a third of that fall.
- [ ] Given `scripts/check-bundle.sh`, when it runs, then the bundle stays within Q-3.

## Read first

- `docs/plan/first-frame/spec.md`.
- ADR-0032 (all of it), ADR-0028 (*Bridge*, *What the bridge cannot see*, *Shell*), ADR-0022,
  ADR-0007 (protected parts), ADR-0002 (markers).
- `crates/engine-wasm/src/graph_data.rs` (`NodeInput`, `text_length`, `node_of`, `checked_node`,
  `nodes_of`, `ids_of`, `graph_of`, `add_node_to`), `crates/engine-wasm/src/lib.rs`
  (`load_graph`), `packages/comb/src/bridge/index.ts` (`loadGraph`, `GraphSnapshot`),
  `packages/comb/src/api/snapshot.ts` (`cut`, `nodeOf`), `packages/comb/src/api/editors.ts` (the
  load).
- The glue wasm-bindgen generates, `packages/comb/wasm/engine.js`, for how a string and a typed
  array cross.

## Blocked by

- docs/plan/first-frame/02-the-store-and-the-snapshot-read-a-load-once.md

## Mode

with the human: it waits for the specification change and for the maintainer to accept ADR-0032,
and it changes the data format of the bridge and the validation of graph data
(`crates/engine-wasm/`, `packages/comb/src/bridge/`) and `packages/comb/src/api/`, protected parts
of ADR-0007.
