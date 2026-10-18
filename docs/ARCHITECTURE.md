# Architecture — Comb

> The system **as it stands today**: the parts it is built from, what each is responsible for, and
> how they fit together. It holds no rule and no decision. It names the ADR behind each structural
> choice; where it disagrees with an accepted ADR, the ADR is right and this document is stale. It
> is updated in the same change as the structure it describes
> ([ADR-0001](adr/0001-agent-governance-model.md)).
>
> **Last design revision:** 2026-10-18, due after 20 changes. The revision that ran moves the
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

Graph data from the host application is untrusted: the engine refuses non-finite coordinates,
invalid sizes, duplicate identifiers, edges to missing nodes, and non-finite label placements with
a typed error.

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
  of detail. It depends on no crate that reaches the browser.
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
  edge mesh with a shader that leaves out the gaps of dash patterns. Not built yet: the node
  content of [ADR-0013](adr/0013-node-content-model.md), and the `grid` and `connectors` layers
  of [ADR-0012](adr/0012-virtualized-scene-graph.md).
- **API** (`packages/comb/src/api`) — `createComb`, which refuses with a
  `RendererUnavailableError` where PixiJS finds no WebGL2, the graph data handed to the engine, the
  viewport (`fitView`, `setViewport`, `viewport`), and the events to the host application;
  `whenRendered` resolves once a change is drawn, with one render per animation frame scheduled
  by `frames`.
- **Testing entry** (`comb/testing`, `packages/comb/src/testing.ts`) — `inspect` returns what the
  scene draws; `viewport` and `renderCount`, cheap enough for every frame, return its transform and
  how often it rendered; `screenPoint` and `visibleRect` apply the scene's transform between world
  and screen; `showLayers` hides layers for a reference image; `levelScales` says where the levels
  of detail begin; for tests, the benchmark, and tooling. Its shape follows the scene and is
  outside the stable interface of `comb`.
- **Example** (`examples/metric-tree`) — a host application with a metric tree and an HTML
  sidebar (G-9); `?copies=` sets its size, the copies lie in a grid about as wide as tall, and it
  reports its load time as `window.loadReport`.
- **Benchmark** (`bench/run.ts`) — the example at 50,010 nodes in Chromium, measuring the time to
  the first frame and p95 frame times of drag, pan, and zoom over the frames Comb rendered, and of
  a pan where the near and the middle level begin, each gesture checked for its effect (Q-1, Q-2).
  `bench/compare.ts` holds the median of several runs against `bench/baseline.json` with a margin
  of 25 %; the baseline is the median of three runs on a GitHub runner on `main`; the
  **Benchmark** workflow (`.github/workflows/benchmark.yml`) runs the benchmark three times and
  compares on a GitHub runner, weekly and on demand.

**Test pattern:** Rust unit tests beside the code they test (`#[cfg(test)]`); Bun tests beside
their module as `*.test.ts`, the bridge's against the built WebAssembly module; browser tests
under `examples/*/e2e`, run by Playwright on Bun against the example, reading what is drawn
through `comb/testing` rather than pixels, apart from one reference image of the edges alone.
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
`packages/comb/wasm/` (generated, not tracked); the library imports it from there, and Vite serves
the example from source. `bun run build:lib` bundles the library without PixiJS into
`packages/comb/dist/`, with the WebAssembly inlined; that bundle is what the budget of Q-3
measures.

**Holding the shape.** `scripts/check-structure.sh` fails when the engine's core names or, through
`Cargo.lock`, reaches a crate that touches the browser, when a module other than the bridge
imports the WebAssembly package, when the render layer reaches the store instead of the action-free
`GraphView`, or when an example imports past the library's entries (ADR-0009), and when the render
layer names PixiJS's `Text`, `HTMLText`, or `SplitText` or the edges layer a `Graphics`
(ADR-0012). `scripts/check-bundle.sh` builds the library and fails when its gzipped JavaScript
and WebAssembly reach the 300 kB of Q-3. `scripts/check-dependencies.sh` fails on a lockfile of
another package manager beside `bun.lock` (ADR-0008), on tsify's default or `json` features or
`serde_json` in the bridge crate (ADR-0010), in whatever form the entry takes, and on a listed
state library other than zustand in the library's dependency lists (ADR-0011). The type checker
does the rest for the render layer: `GraphView` has no action to call.
