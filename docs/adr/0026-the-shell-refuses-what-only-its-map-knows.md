# ADR-0026: A pure Rust engine as functional core, and a TypeScript shell around it, with the shell refusing what only its map of identifiers knows

- **Status:** 🟡 proposed
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules
- **Supersedes:** [ADR-0009](0009-functional-core-imperative-shell.md)

## Context

The specification splits Comb into a TypeScript canvas rendered with PixiJS and a Rust engine
compiled to WebAssembly ([Constraints](../SPECIFICATION.md#constraints)). The logic that decides
the goals is geometry: edge paths, the position of an edge label from its path parameter and
label offset (G-6), the path parameter nearest to a dragged label, hit tests for connectors (G-3),
and the spatial query that culling needs (G-7). Q-4 asks for that geometry to be exact to 0.5 px,
which wants exhaustive tests of pure functions. The effects are few: pointer and keyboard input,
drawing with PixiJS, and the events to the host application.

That is the shape the catalogue's *functional core, imperative shell* fits: rich logic, few
effects. Its *Does not fit* warns of large mutable state copied on every step; with 50,000 nodes
(Q-1) the engine cannot copy the graph per frame, so its functions read and write buffers handed
to them and stay deterministic and free of effects.

ADR-0009 decided this shape and let `api` refuse, against the store's map from identifiers to
slots, only an identifier `updateNode` names that the graph does not hold. Editing the graph
(ADR-0022, ADR-0023) brings more refusals of that kind: identifiers that `removeNodes`,
`removeEdges`, and `updateEdge` name and the graph does not hold, identifiers that `addNode`,
`addEdge`, and a user's connection add and the graph holds already, and an `addEdge` whose end
the graph does not hold. The engine keeps no identifiers (ADR-0010), so the bridge crate cannot
check any of them against the graph it holds. This ADR carries ADR-0009 over whole and widens
that one clause to every refusal that needs the map, on the maintainer's decision.

*Ports and adapters* would put the renderer behind a port, but PixiJS is a constraint, so the
port would have one adapter forever. A *plugin* interface for content elements (G-10) would
freeze a shape nobody can describe before the elements exist.

## Decision

We will build Comb as a functional core of pure Rust functions in `crates/engine`, wrapped for
WebAssembly by `crates/engine-wasm`, and an imperative shell in TypeScript in `packages/comb`,
whose only door to the engine is its `bridge` module.

- **Layout:** a Cargo workspace with `crates/engine` and `crates/engine-wasm`; Bun workspaces with
  `packages/comb`, the library, and `examples/metric-tree`, the example of G-9.
- **Core:** `crates/engine` depends on no crate that reaches the browser, the clock, randomness,
  or I/O: not `wasm-bindgen`, `js-sys`, `web-sys`, `getrandom`, or `serde-wasm-bindgen`. Its
  functions take values and buffers and return values or write into buffers they are given.
- **Bridge:** `crates/engine-wasm` holds every `#[wasm_bindgen]` export and converts between the
  bridge's data and the core's types; it holds no geometry of its own. It is the one place that
  validates graph data: every field the host application hands over crosses the bridge and is
  checked there, also a field the engine does not keep, such as a title, a label's text, a
  label's background, and the patch of `updateNode`. It bounds what a load may hold: at most
  1,000,000 nodes and 1,000,000 edges, at most 256 UTF-16 code units per identifier (a node's or
  an edge's, a source, a target), at most 64,000,000 code units of identifiers per load, and at
  most 1,000 code units per title and per label text.
- **What the bridge cannot see:** `api` decides two things itself, each because the bridge cannot.
  A string the store keeps that holds a lone surrogate, which serde-wasm-bindgen hands the bridge
  crate as U+FFFD, so that it would check another string than the store keeps, is handed over as
  `false`, which the bridge refuses as a value of the wrong type; a patch's key, which the store
  does not keep, crosses as written and is named with U+FFFD in its place. And `api` checks,
  against the store's map from identifiers to slots, which only the shell keeps (ADR-0010), what
  only that map knows,
  whichever method of the public interface or gesture asks: an identifier named that the graph
  does not hold (`unknownNode`, `unknownEdge`), as `updateNode`, `removeNodes`, `removeEdges`, and
  `updateEdge` name one; an identifier added that the graph holds already (`duplicateNode`,
  `duplicateEdge`), as `addNode`, `addEdge`, and the identifier of a user's connection add one; and
  an end of an edge added that the graph does not hold (`missingNode`). A load needs nothing of
  the map, since it replaces the graph and its batch holds every identifier it names, so the
  bridge crate keeps checking a load's duplicates and missing ends within the batch. Every other
  refusal, the limits among them, is the bridge crate's, and `api` reads the limits from it; the
  defaults `api` fills in for an edge's colour, arrowhead, and sides refuse nothing. Each refusal
  `api` makes is a kind of the generated `GraphDataProblem` (ADR-0010).
- **Shell:** `packages/comb/src` has the modules `api` (the public interface, which only reads:
  it copies the host application's graph data once into primitives, what it cannot read is
  malformed, and it hands the copy to the bridge before the store keeps any of it), `store`
  (graph and viewport state), `interaction` (input into commands on the store), `render` (the
  PixiJS scene: nodes, edges, and edge labels in containers of their own), and `bridge` (the one
  module that imports the WebAssembly package).
- **Direction:** `render` reads the store and never writes it; only `bridge` imports the
  WebAssembly package; `examples/` import only the package's entries: `comb`, the public
  interface; `comb/testing`, which reads what the canvas draws for browser tests and the
  benchmark and is no part of the stable interface; and `comb/engine.wasm`, the engine's file,
  which a host application hands to `createComb`
  ([ADR-0019](0019-the-host-hands-comb-its-engine.md)), bare or as a URL (`?url`).

**Out of scope:** the data format of the bridge, the store library, the structure of the scene
graph, and the model of node content, each a decision of its own.

## Alternatives considered

- **Keeping ADR-0009's clause, `updateNode` alone** — the letter stays, but every new method that
  names or adds an identifier would refuse it nowhere, or the engine would keep a second map of
  identifiers, against ADR-0010's slots.
- **The bridge handed what the map says** — `api` would pass the bridge crate a flag "known" or
  "taken" with each identifier, so that the bridge crate formally refuses; the decision would
  still be `api`'s, behind a flag that hides it.
- **Validation split by where a field is kept** — the bridge crate checks what the engine keeps,
  and `api` checks in TypeScript what only the store keeps. No text crosses the bridge, but there
  are two places of validation, and error kinds written by hand stand beside the generated ones
  of ADR-0010.
- **Lone surrogates checked in the bridge crate** — one place for that refusal too, but the
  bridge would have to read each string as a JavaScript string before serde-wasm-bindgen converts
  it, outside the generated types of ADR-0010, for a refusal `api` makes with one expression.
- **Validation in `api` alone** — the shell checks all graph data in TypeScript before the
  bridge. The bridge crate would check again in its own types, so every rule would be written
  twice in two languages.
- **Ports and adapters** — a seam for swapping the renderer, which the PixiJS constraint rules
  out; every port would have one adapter forever.
- **Plugin for content elements** — third parties could add elements, but an extension interface
  before the elements exist freezes the wrong shape; a later ADR can add one.
- **One Rust crate with the `#[wasm_bindgen]` exports beside the geometry** — one crate fewer, but
  then no check can tell the core from the bridge, and the geometry is no longer testable without
  WebAssembly.
- **Inspection through the public interface** — one entry fewer, but every probe a test or the
  benchmark needs would become part of the stable interface a host builds on.
- **Examples read the scene through a path inside `packages/comb`** — no second entry, but then
  no check can tell an allowed probe from a reach into the library's internals.
- **A flat layout with `src/`, `engine/`, and `example/` in one package** — simpler at first, but
  the example would import the library's internals, and the library could not be published on its
  own.

## Sources / Prior art

- The *Functional core, imperative shell* entry of the `propose-adr` concept catalogue; Gary
  Bernhardt, *Boundaries* — <https://www.destroyallsoftware.com/talks/boundaries>.
- Cargo workspaces — <https://doc.rust-lang.org/cargo/reference/workspaces.html>; Bun workspaces
  — <https://bun.sh/docs/install/workspaces>.

## Consequences

- Positive: the geometry that decides G-3, G-6, G-7, and Q-4 runs under `cargo test` natively,
  fast and without a browser.
- Positive: the bridge is one module on each side, so its format can change in one place when the
  benchmark asks for it.
- Negative / trade-offs: two crates and two npm packages from the first commit, more files than
  the skeleton needs.
- Negative / trade-offs: functions over buffers are less obviously pure than functions over
  values; review holds that they write only the buffers they are given.
- Negative / trade-offs: `api` holds a few refusals of its own beside the bridge crate's, each a
  lookup in the map; review keeps them to what only the map knows.
- Negative / trade-offs: titles and label texts cross the bridge once more when a graph loads,
  only to be checked; the benchmark's first frame shows what that costs (Q-2).
- Follow-ups: the data format of the bridge; the store; the scene graph and its culling; the model
  of node content.

## Enforcement

A structural test in `scripts/` fails when `crates/engine/Cargo.toml` names a forbidden crate, when
a file outside `packages/comb/src/bridge/` imports the WebAssembly package, when a file in
`packages/comb/src/render/` calls a writing action of the store, or when a file in `examples/`
imports anything of `packages/comb` other than its entries `comb`, `comb/testing`, and
`comb/engine.wasm`, the last bare or with `?url` alone. The test cites this ADR with `Verifies:
ADR-0026`. The property test of the bridge crate generates every field of graph data, those the
engine does not keep among them, and a browser test refuses a malformed title, label text, label
background, and patch of `updateNode` through the public interface; both cite this ADR. Browser
tests refuse a lone surrogate in an identifier and in a title, citing this ADR, and an `updateNode`
of an identifier the graph does not hold, citing Q-7, through the public interface; browser tests of
each new method refuse an unknown, a duplicate, and a missing identifier through the public
interface, citing this ADR and Q-7. The tests that cited ADR-0009 cite this ADR, since a superseded
ADR is cited by none. That a function of the core writes only the buffers it is given, and that
`api` refuses nothing of graph data beyond what the bridge cannot see, is review.
