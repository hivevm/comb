# ADR-0009: A pure Rust engine as functional core, and a TypeScript shell around it

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules

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
  bridge's data and the core's types; it holds no geometry of its own.
- **Shell:** `packages/comb/src` has the modules `api` (the public interface and the validation
  of graph data), `store` (graph and viewport state), `interaction` (input into commands on the
  store), `render` (the PixiJS scene: nodes, edges, and edge labels in containers of their own),
  and `bridge` (the one module that imports the WebAssembly package).
- **Direction:** `render` reads the store and never writes it; only `bridge` imports the
  WebAssembly package; `examples/` import only the package's two entries: `comb`, the public
  interface, and `comb/testing`, which reads what the canvas draws for browser tests and the
  benchmark and is no part of the stable interface.

**Out of scope:** the data format of the bridge, the store library, the structure of the scene
graph, and the model of node content, each a decision of its own.

## Alternatives considered

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
- Follow-ups: the data format of the bridge; the store; the scene graph and its culling; the model
  of node content.

## Enforcement

A structural test in `scripts/` fails when `crates/engine/Cargo.toml` names a forbidden crate,
when a file outside `packages/comb/src/bridge/` imports the WebAssembly package, when a file in
`packages/comb/src/render/` calls a writing action of the store, or when a file in `examples/`
imports anything of `packages/comb` other than its entries `comb` and `comb/testing`. The test
cites this ADR with `Verifies: ADR-0009`. That a function of the core writes only the buffers it
is given is review.
