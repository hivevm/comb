# Architecture — Comb

> The system **as it stands today**: the parts it is built from, what each is responsible for, and
> how they fit together. It holds no rule and no decision. It names the ADR behind each structural
> choice; where it disagrees with an accepted ADR, the ADR is right and this document is stale. It
> is updated in the same change as the structure it describes
> ([ADR-0001](adr/0001-agent-governance-model.md)).
>
> **Last design revision:** 2026-10-21, due after 20 changes. The revision that ran moves the
> date; the number is this project's to set; a sensor counts the changes outside `docs/` since
> the commit that set the date and says when the next is due
> ([ADR-0006](adr/0006-feature-layer.md)).

## Context

```
 host application (its HTML sidebar, palette, persistence)
        │  graph data in, selection events out          ▲
        ▼                                                │
 ┌──────────────── packages/comb (TypeScript) ──────────┴──┐
 │ api → store ← interaction        render (PixiJS, WebGL2) │
 │              bridge ──────────────────────────────┐      │
 └──────────────────────────────────────────────────┼──────┘
                                                    ▼
 ┌──────── crates/engine-wasm → crates/engine (Rust, WebAssembly) ┐
 │ node positions and sizes, edges, spatial index, edge paths      │
 └────────────────────────────────────────────────────────────────┘
```

Graph data from the host application is untrusted: the bridge crate refuses a value of the wrong
shape, coordinates, sizes, and dash patterns that are not finite as the engine keeps them (`f32`),
negative sizes, a dash that is not positive or a negative gap, duplicate node or edge
identifiers, edges to missing nodes, non-finite label placements, and colours beyond `0xFFFFFF`
with a typed error, and `updateNode` refuses an identifier the graph does not hold. Titles, label
texts, and label backgrounds never reach the engine, and nothing checks them or the patch that
`updateNode` merges into the store.

## Building blocks

The functional core and its shell follow [ADR-0009](adr/0009-functional-core-imperative-shell.md).

- **Engine** (`crates/engine`) — pure geometry: edge paths as cubic Bézier curves from the right
  middle of one node to the left middle of another, their exact bounds, the point and normal at a
  path parameter, and edge-label placement. `graph` keeps the loaded graph, node positions and
  sizes per slot and edges per slot, and a spatial index (`spatial`, a uniform grid each for nodes
  and edges, with an overflow list for items that cover many cells) that loads and moves keep
  current and that is built again once many items have moved beyond its extent; its query
  returns the slots a rectangle meets, and `hit` the node drawn on top at a point. `stroke`
  flattens the found edges within a tolerance and strokes them into the triangles of one mesh,
  with each edge's colour, dash pattern, and arrowhead, or as thin lines alone at the far level
  of detail. It depends on no crate that reaches the browser. `graph` keeps each edge's path and
  its bounds as of its last move, so that a query computes no bounds; `graph::slot` is the one
  conversion of a count to slots, which the bridge uses too. Only what the bridge uses is public;
  the rest is private to the crate, so that the `dead_code` lint finds what only tests reach.
- **Bridge** — `crates/engine-wasm` holds every WebAssembly export: `loadGraph` checks graph data
  and resolves edge ends to slots, `translate` moves nodes, `query` takes a rectangle, a level of
  detail, and the size of a screen pixel and writes the found node slots, the edge-label slots and
  points (at the near level only), the found edge slots, and the edge mesh into buffers the engine
  owns, `drawnEdges` computes the ends of the found edges when inspection asks, as they lie then,
  and `hit` names the node at a point;
  `packages/comb/src/bridge` is the one module that imports the WebAssembly package and reads
  those buffers through fresh typed-array views per read
  ([ADR-0010](adr/0010-bridge-data-format.md)).
- **Store** (`packages/comb/src/store`) — a vanilla Zustand store with the graph's structure, the
  selection, the viewport, and a counter for moved positions; no coordinates
  ([ADR-0011](adr/0011-store.md)). `GraphView` is its state without the actions, the type the
  render layer reads.
- **Interaction** (`packages/comb/src/interaction`) — pointer and wheel input into store actions
  and engine moves: drag a node, pan, zoom around the pointer. The engine's `hit` says which node
  the pointer is on, at every level of detail; node views take no events. `viewport.ts` holds the
  viewport's arithmetic, the transform between world and screen included, for interaction, the
  scene, and the testing entry.
- **Render** (`packages/comb/src/render`) — the PixiJS scene (`scene.ts`): a `world` render
  group with the layers `EdgesContainer` (`edges.ts`), `NodeParticles` (`particles.ts`),
  `NodesContainer` (`nodes.ts`), and `LabelsContainer` (`labels.ts`), and an `overlay`
  ([ADR-0012](adr/0012-virtualized-scene-graph.md)); `bindings.ts` is the pool of views the
  nodes and labels layers bind to slots. The scale chooses the level of
  detail: near (from 0.6) draws node views and edge labels, middle (from 0.3) node views alone,
  and far nodes as particles of one `ParticleContainer` (`render/particles.ts`) and edges as
  lines one pixel wide. A render queries the engine for the viewport grown by the culling margin
  and binds pooled node views and edge-label views to exactly the slots it found, drawn in slot
  order; while the viewport stays within what it last queried, at about its scale, and the graph
  is unchanged, a render moves the world alone. `EdgesContainer` (`render/edges.ts`) draws the
  edge mesh with a shader that leaves out the gaps of dash patterns; on the Canvas 2D renderer a
  host application opts into ([ADR-0018](adr/0018-webgl2-or-an-opted-in-canvas-fallback.md)),
  which runs no shader, `EdgeFill` (`render/edges-canvas.ts`) takes its place, builds no mesh,
  and fills the same triangles into one `Graphics`, one fill per run of one colour, dash
  patterns solid. Not built yet: the node content of
  [ADR-0013](adr/0013-node-content-model.md), and the `grid` and `connectors` layers of
  [ADR-0012](adr/0012-virtualized-scene-graph.md).
- **API** (`packages/comb/src/api`) — `api/index.ts` imports `pixi.js/unsafe-eval` before
  PixiJS, so that no PixiJS renderer on the page generates code with eval
  ([ADR-0020](adr/0020-pixijs-without-eval.md)); `createComb`, which takes the engine's
  WebAssembly from the host application as `engine` and refuses with an `EngineSourceError`
  where it is missing, a string, `URL`, or `Request`, or none of a `Response`, a module, and the
  bytes (`api/engine.ts`, [ADR-0019](adr/0019-the-host-hands-comb-its-engine.md)), before it
  touches the host element,
  and with a `RendererUnavailableError` where PixiJS finds no WebGL2 unless `allowCanvasFallback`
  lets it draw on Canvas 2D, the graph data handed to the engine, the viewport (`fitView`,
  `setViewport`, `viewport`), and the events to the host application;
  `whenRendered` resolves once a change is drawn, with one render per animation frame scheduled
  by `frames`.
- **Testing entry** (`comb/testing`, `packages/comb/src/testing.ts`) — `inspect` returns what the
  scene draws, the text of the titles and labels drawn included; `viewport` and `renderCount`, cheap
  enough for every frame, return its transform and how often it rendered; `screenPoint` and
  `visibleRect` apply the scene's transform between world and screen; `showLayers` hides layers for
  a reference image; `sceneNumbers` gives the numbers the scene draws by (where the levels of detail
  begin, the culling margin, the label reach, the rescale); `work` counts what the canvas did: GPU
  buffers created and allocated, bytes uploaded, those of the edge mesh among them, and texture
  uploads, counted at the WebGL context from its first call, resizes of the edge mesh's buffers, and
  views the pools made, and refuses where the canvas draws without WebGL; for tests, the benchmark,
  and tooling. Its shape follows the scene and is outside the stable interface of `comb`.
- **Example** (`examples/metric-tree`) — a host application with a metric tree and an HTML
  sidebar (G-9); `?copies=` sets its size, the copies lie in a grid about as wide as tall, and it
  reports its load time as `window.loadReport`; `?fallback=canvas` allows the Canvas 2D fallback;
  it fetches the engine file Vite emits for its `comb/engine.wasm?url` import and hands over the
  promise of the response, or with `?engine=response`, `module`, `bytes`, or `view` that form;
  `window.createComb` and `window.engineUrl` let a browser test make a second Comb in a host
  element of its own.
- **Benchmark** (`bench/run.ts`) — the example at 50,010 nodes in Chromium, measuring the time to
  the first frame and p95 frame times of drag, pan, and zoom over the frames Comb rendered, and of
  a pan where the near and the middle level begin, each gesture checked for its effect (Q-1, Q-2).
  After the first frame and before the gestures it times the reference workload of
  `bench/reference.ts` in the same page, which uses the browser's JavaScript, WebAssembly, and
  WebGL2 and none of Comb's code. `bench/compare.ts` refuses a run whose reference differs from
  the baseline's by more than 25 % in a part, and holds the median of several runs against
  `bench/baseline.json` with a margin of 25 %; the baseline is the median of three runs
  on a GitHub runner on `main`; the **Benchmark** workflow (`.github/workflows/benchmark.yml`)
  runs the benchmark three times and compares on a GitHub runner, weekly and on demand.
- **Mutation testing** (`.github/workflows/mutation.yml`) — cargo-mutants mutates `crates/engine`
  on a GitHub runner, weekly and on demand; `scripts/check-mutants.sh` compares the surviving
  mutants with `crates/engine/mutants-missed.txt` by file, function, and replacement, and fails
  on a survivor the list does not name (ADR-0008).

**Test pattern:** Rust unit tests beside the code they test (`#[cfg(test)]`), and a property test
of the bridge crate's validation (`crates/engine-wasm/src/properties.rs`, proptest) that feeds it
10,000 random batches per run against a brute-force oracle; Bun tests beside
their module as `*.test.ts`, the bridge's against the built WebAssembly module, and the lint's
rules for Comb's library sources in `packages/comb/src/lint.test.ts`; browser tests
under `examples/*/e2e`, run by Playwright on Bun against the example, reading what is drawn
through `comb/testing` rather than pixels, apart from one reference image of the edges alone.
Both run the bridge in test mode, which grows the engine's memory before each of its calls, so a
view kept across a call reads empty; the browser tests serve the example in Vite's `test` mode
for it, on port 5174, and assert it through `testMode()` of `comb/testing`, and the bundle check
fails a bundle that carries it. In test mode the example's Vite configuration sends every response
with the Content Security Policy of Q-6, `default-src 'self'; script-src 'self'
'wasm-unsafe-eval'`, so every browser test runs under it; `e2e/policy.spec.ts` records every
request and `securitypolicyviolation` while the graph loads, is panned, and is zoomed.
Playwright and the benchmark start headless Chromium without the displays a Dev Container
forwards, so WebGL2 runs on SwiftShader instead of PixiJS falling back to Canvas 2D.

## How it runs

**Dragging a node.** `interaction` turns the pointer delta into world units and calls
`bridge.translate`, which moves the slot in the engine's positions buffer and recomputes the
node's edges and their place in the spatial index; it then bumps the store's `positionsVersion`.
The store notifies the scene, which renders once per animation frame: it queries the engine for
the viewport grown by the culling margin, binds node views and edge-label views to the slots
found, and uploads the edge mesh the query built, so edges and labels follow the node in the
same frame.

**Panning and zooming.** `interaction` sets the store's viewport. While the viewport stays inside
the rectangle the scene last queried, at a scale within a factor of 1.25 of the one it queried at,
the world moves alone; beyond that the scene renders as above, so what leaves the viewport and its
margin returns its views to the pools and what enters takes them from there. The mesh is flattened
within a quarter pixel at the current zoom, so zoomed out it has fewer points. A resize of the
canvas renders too.

**Building.** `bun run build:engine` compiles `crates/engine-wasm` with wasm-pack into
`packages/comb/wasm/` (generated, not tracked), with glue that has no default path to the engine
file (`omit-default-module-path` in its `Cargo.toml`); the library imports the glue from there,
`comb` exports the file `wasm/engine_bg.wasm` as `comb/engine.wasm`, and Vite serves the example
from source. `bun run build:lib` bundles the library without PixiJS into `packages/comb/dist/`,
without the WebAssembly, which the host application hands over (ADR-0019); that bundle and the
engine file are what the budget of Q-3 measures, and the bundle check fails a bundle that inlines
the engine.

**Loading the engine.** `createComb` settles the host application's promise, if it handed one
over, refuses what is missing, would be fetched, or is none of a `Response`, a module, and the
bytes, and passes the rest to the glue's initialiser, which compiles a `Response` while it streams
and instantiates a module or bytes. The glue instantiates once per page and returns that instance
to every later call, so a later `createComb` checks its engine but does not use it. The Bun tests
create the bridge from the bytes with `createBridgeSync`.

**Holding the shape.** `scripts/check-structure.sh` fails when the engine's core names or, through
`Cargo.lock`, reaches a crate that touches the browser, when a module other than the bridge
imports the WebAssembly package, when the render layer reaches the store instead of the action-free
`GraphView`, or when an example imports past the library's entries and its engine file
(ADR-0009, ADR-0019), and when the render layer names PixiJS's `Text`, `HTMLText`, or
`SplitText` or the edges layer a `Graphics` (ADR-0012), and when its Canvas 2D fallback names
`Graphics` outside its imports and its one field (ADR-0018). `scripts/check-bundle.sh` builds
the library and fails when its gzipped JavaScript and the engine file reach the 300 kB of Q-3,
or when the JavaScript inlines the engine (ADR-0019). `scripts/check-dependencies.sh` fails on a
lockfile of another package manager beside `bun.lock` (ADR-0008), on tsify's default or `json`
features or `serde_json` in the bridge crate (ADR-0010), in whatever form the entry takes, and on
a listed state library other than zustand in the library's dependency lists (ADR-0011). The type
checker does the rest for the render layer: `GraphView` has no action to call. ESLint forbids
the DOM markup sinks (Q-5) and `eval`, implied eval, and `new Function` (Q-6) in Comb's library
sources, outside its tests.
