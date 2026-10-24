# ADR-0028: A pure Rust engine as functional core, and a TypeScript shell around it, the shell refusing what only its map of identifiers knows, and the graph within a world's limit

- **Status:** 🟡 proposed
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules
- **Supersedes:** [ADR-0026](0026-the-shell-refuses-what-only-its-map-knows.md)

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
slots, only an identifier `updateNode` names that the graph does not hold; ADR-0026 carried it
over and widened that refusal, as follows. Editing the graph
(ADR-0022, ADR-0023) brings more refusals of that kind: identifiers that `removeNodes`,
`removeEdges`, and `updateEdge` name and the graph does not hold, identifiers that `addNode`,
`addEdge`, and a user's connection add and the graph holds already, and an `addEdge` whose end
the graph does not hold. The engine keeps no identifiers (ADR-0010), so the bridge crate cannot
check any of them against the graph it holds. ADR-0026 carried ADR-0009 over whole and widened
that one clause to every refusal that needs the map, on the maintainer's decision.

The bridge refuses a coordinate or a size that is not finite as the engine keeps it, `f32`, but
that bounds nothing the engine derives from them. A node at `x = 3e38` of `width = 3e38` holds
both as `f32` and has its far side past `f32::MAX`; a drag moves a node in `f32` without bound;
and an edge between nodes near the two ends of `f32`'s range pulls its control points up to
twice the distance between its ends, past it too. An edge end, a vertex, or a label point that
turns infinite breaks Q-4, and accepted graph data would then draw what Q-7 says it never does.
So the bridge's bounds of a load gain a bound of where the graph lies, and the engine keeps it
there, on the maintainer's decision that a drag is cut at the bound rather than refused. This ADR
carries ADR-0026 over whole and adds that bound to its *Bridge* clause and a clause *World*.

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
  an edge's, a source, a target), at most 64,000,000 code units of identifiers per load, at
  most 1,000 code units per title and per label text, and a graph within the world's limit, as
  *World* says: it refuses a node whose coordinate or far side, `x + width` or `y + height` as
  `f32` holds them, lies more than 2^120 world units from the origin, and a label offset beyond
  that, as `addNode`, `addEdge`, and `updateEdge` hand them over too, with the kind
  `beyondWorld`, which names the list, the node or edge, the field, and the limit.
- **World:** the core keeps the graph within the world's limit, `WORLD_LIMIT`, 2^120 world units
  of the origin on each axis, so that every point it derives from the graph, a connector, a
  control point, a vertex, a label point, and every coordinate it writes relative to a query's
  origin, stays within `f32`. A move of nodes stops each where its far side meets the limit, a
  drag's included, and a label dragged to a point beyond it stops at it; a query strokes for at
  most 2^114 world units a screen pixel, far beyond the shell's least zoom. The limit lies far
  beyond any graph a host application draws: ADR-0010's origin holds the rounding near the
  rectangle to Q-4 at 5e7 world units, 2^25 and more, where 2^120 is about 1.3e36.
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

- **No bound beyond `f32` (ADR-0026 as it stands)** — nothing to refuse beyond what `f32` holds,
  but a node near `f32::MAX`, a drag, or an edge across its range turns a derived point infinite,
  against Q-4 and Q-7.
- **A far side finite as `f32`** — refuses the node at `3e38` of `width = 3e38`, but an edge
  between nodes at `±3e38` still pulls its control points past `f32::MAX`; a bound has to leave
  room for what is derived.
- **A drag refused at the bound** — the gesture would stop with an error the user never caused;
  the maintainer chose cutting it.
- **Derived points cut to `f32` as they are written** — nothing refused, but a vertex cut is no
  longer on its path, and the drawing would be wrong where it should be absent.
- **The query's rectangle cut to the world** — keeps the origin within the world as well, but moves
  it off what ADR-0010 decides, the rectangle's centre snapped to its grid, and the bound needs it
  not: an origin of a rectangle that finds anything lies within 2^127 of it.

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
- Positive: no graph data the bridge accepts, and no drag, makes the engine write a coordinate
  `f32` does not hold (Q-4, Q-7).
- Negative / trade-offs: graph data between 2^120 and `f32::MAX` world units from the origin,
  accepted before, is refused, and `GraphDataProblem` has one kind more, which a host's `switch`
  on its kinds has to take.
- Negative / trade-offs: a node dragged to the limit stops there without a word; the user sees
  it stop, the host the `nodeMoved` of where it stopped.
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
interface, citing this ADR and Q-7. A test of the bridge crate refuses a node whose coordinate or
far side lies beyond the world's limit, and a label offset beyond it, naming the field, and a
browser test refuses both through `load`; a test of the core drags nodes by `f32::MAX` and labels
to `1e300` and queries rectangles at `±1e300`, at `3e38`, and one whose origin snaps to 2^127, at
every level and at a pixel of `1e300`, and asserts that every coordinate written is one `f32`
holds; each cites this ADR. The tests that cited ADR-0026 cite this ADR, since a superseded ADR is
cited by none. A type test refuses handing the bridge anything but the snapshot and the
plain patch `api` builds (`packages/comb/src/bridge/snapshot-only.test.ts`), citing this ADR. That
a function of the core writes only the buffers it is given, and that
`api` refuses nothing of graph data beyond what the bridge cannot see, is review.
