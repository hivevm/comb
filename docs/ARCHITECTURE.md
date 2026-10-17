# Architecture — Comb

> The system **as it stands today**: the parts it is built from, what each is responsible for, and
> how they fit together. It holds no rule and no decision. It names the ADR behind each structural
> choice; where it disagrees with an accepted ADR, the ADR is right and this document is stale. It
> is updated in the same change as the structure it describes
> ([ADR-0001](adr/0001-agent-governance-model.md)).
>
> **Last design revision:** 2026-10-04, due after 20 changes. The revision that ran moves the
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
  returns the slots a rectangle meets. It depends on no crate that reaches the browser.
- **Bridge** — `crates/engine-wasm` holds every WebAssembly export: `loadGraph` checks graph data
  and resolves edge ends to slots, `translate` moves nodes, and `query` writes the found node
  slots, edge slots, edge control points, and edge-label points into buffers the engine owns;
  `packages/comb/src/bridge` is the one module that imports the WebAssembly package and reads
  those buffers through fresh typed-array views per read
  ([ADR-0010](adr/0010-bridge-data-format.md)).
- **Store** (`packages/comb/src/store`) — a vanilla Zustand store with the graph's structure, the
  selection, the viewport, and a counter for moved positions; no coordinates
  ([ADR-0011](adr/0011-store.md)). `GraphView` is its state without the actions, the type the
  render layer reads.
- **Interaction** (`packages/comb/src/interaction`) — pointer and wheel input into store actions
  and engine moves: drag a node, pan, zoom around the pointer.
- **Render** (`packages/comb/src/render`) — the PixiJS scene: a `world` render group with the
  `EdgesContainer`, `NodesContainer`, and `LabelsContainer` layers, and an `overlay`
  ([ADR-0012](adr/0012-virtualized-scene-graph.md)). Each render queries the engine for the
  viewport grown by the culling margin and binds pooled node views and edge-label views to
  exactly the slots it found, drawn in slot order; the found edges share one `Graphics`. Not
  built yet: the edge mesh, levels of detail, and the node content of
  [ADR-0013](adr/0013-node-content-model.md).
- **API** (`packages/comb/src/api`) — `createComb`, the graph data handed to the engine, the
  viewport (`fitView`, `setViewport`, `viewport`), and the events to the host application;
  `whenRendered` resolves once a change is drawn, with one render per animation frame scheduled
  by `frames`.
- **Testing entry** (`comb/testing`, `packages/comb/src/testing.ts`) — `inspect` returns what the
  scene draws; `viewport` and `renderCount`, cheap enough for every frame, return its transform and
  how often it rendered; for tests, the benchmark, and tooling. Its shape follows the scene and is
  outside the stable interface of `comb`.
- **Example** (`examples/metric-tree`) — a host application with a metric tree and an HTML
  sidebar (G-9); `?copies=` sets its size, the copies lie in a grid about as wide as tall, and it
  reports its load time as `window.loadReport`.
- **Benchmark** (`bench/run.ts`) — the example at 50,010 nodes in Chromium, measuring the time to
  the first frame and p95 frame times of drag, pan, and zoom over the frames Comb rendered, each
  gesture checked for its effect (Q-1, Q-2).

**Test pattern:** Rust unit tests beside the code they test (`#[cfg(test)]`); Bun tests beside
their module as `*.test.ts`, the bridge's against the built WebAssembly module; browser tests
under `examples/*/e2e`, run by Playwright on Bun against the example, reading what is drawn
through `comb/testing` rather than pixels.

## How it runs

**Dragging a node.** `interaction` turns the pointer delta into world units and calls
`bridge.translate`, which moves the slot in the engine's positions buffer and recomputes the
node's edges and their place in the spatial index; it then bumps the store's `positionsVersion`.
The store notifies the scene, which renders once per animation frame: it queries the engine for
the viewport grown by the culling margin, binds node views and edge-label views to the slots
found, and draws the found edges from the control points the query returned, so edges and labels
follow the node.

**Panning and zooming.** `interaction` sets the store's viewport; the scene renders as above, so
what leaves the viewport and its margin returns its views to the pools and what enters takes them
from there. A resize of the canvas renders too.

**Building.** `bun run build:engine` compiles `crates/engine-wasm` with wasm-pack into
`packages/comb/wasm/` (generated, not tracked); the library imports it from there, and Vite serves
the example from source. `bun run build:lib` bundles the library without PixiJS into
`packages/comb/dist/`, with the WebAssembly inlined; that bundle is what the budget of Q-3
measures.

**Holding the shape.** `scripts/check-structure.sh` fails when the engine's core names or, through
`Cargo.lock`, reaches a crate that touches the browser, when a module other than the bridge
imports the WebAssembly package, when the render layer reaches the store instead of the action-free
`GraphView`, or when an example imports past the library's entry (ADR-0009). The type checker
does the rest for the render layer: `GraphView` has no action to call.
