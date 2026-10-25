# Architecture — Comb

> The system **as it stands today**: the parts it is built from, what each is responsible for, and
> how they fit together. It holds no rule and no decision. It names the ADR behind each structural
> choice; where it disagrees with an accepted ADR, the ADR is right and this document is stale. It
> is updated in the same change as the structure it describes
> ([ADR-0001](adr/0001-agent-governance-model.md)).
>
> **Last design revision:** 2026-10-25, due after 20 changes. The revision that ran moves the
> date; the number is this project's to set; a sensor counts the changes outside `docs/` since
> the commit that set the date and says when the next is due
> ([ADR-0006](adr/0006-feature-layer.md)).

## Context

```
 host application (its HTML sidebar, palette, persistence)
        │  graph data and edits in; changes, selection,  ▲
        │  and veto questions out                        │
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

Graph data from the host application is untrusted, and every field of it crosses the bridge before
the store keeps any of it. The bridge crate refuses, each with a typed error: a field that is
missing or holds a value of another type, naming the node or edge by index, and by identifier where
it has one, the field, and what the field expects in plain words (`invalidField`); graph data that
is no object of node and edge lists of objects, as malformed; coordinates, sizes, and dash patterns
that are not finite as the engine keeps them (`f32`), negative sizes, a dash that is not positive or
a negative gap, a node whose coordinate or far side (`x + width`, `y + height`) lies more than the
world's limit, 2^120 world units, from the origin, and a label offset beyond it (`beyondWorld`),
naming the node or edge and the field, duplicate node or edge identifiers, edges to missing nodes,
non-finite label placements, a colour that is not an integer from `0` to `0xFFFFFF`, a title or
label text that is not a string or longer than 1,000 UTF-16 code units, a label background that is
not an integer from `0` to `0xFFFFFF`, more than 1,000,000 nodes or edges, an identifier, source, or
target longer than 256 UTF-16 code units, and identifiers of one load that hold more than 64,000,000
code units together, and an edge side other than `top`, `right`, `bottom`, and `left`. `api`
refuses, against the store's map from identifiers to slots (ADR-0028), an identifier `updateNode` or
`removeNodes` names that the graph does not hold (`unknownNode`), one `updateEdge` or `removeEdges`
names (`unknownEdge`), one `addNode`, `addEdge`, or a user's connection adds that it holds already
(`duplicateNode`, `duplicateEdge`), and an end of an added edge it does not hold (`missingNode`).
The bridge crate checks the node `addNode` and the edge `addEdge` hand over as a load checks one,
refuses an edge from a node to itself (`selfEdge`) and an addition past the 1,000,000 nodes or edges
a load may hold, and `api` has it check the code units of identifiers the store counts with the new
ones; it refuses a patch of `updateNode` that holds a field other than a title, a patch of
`updateEdge` that holds a field other than a colour, dash, arrowhead, label, or side
(`unknownEdgePatchField`), and a field it would refuse in a load. Titles, label texts, and label
backgrounds are checked there but not kept by the engine. `api` reads the host's graph data once, in
JavaScript, into a snapshot (`api/snapshot.ts`) of plain data whose every field is a primitive of
the type it expects, any other value replaced by `false`, and whose texts and identifiers are cut
one code unit beyond the bridge's limits, so that no value of the host application and none of its
code reaches the engine, and a text of any length costs no more than that to check. The bridge's
`loadGraph`, `addNode`, `checkNodePatch`, `addEdge`, and `updateEdge` take only the types
`GraphSnapshot`, `NodeSnapshot`, `PlainPatch`, `EdgeSnapshot`, and `PlainEdgePatch` that the
snapshot's functions return, so that the type checker refuses the host's graph data, node, edge, or
patch handed to the bridge directly (`bridge/snapshot-only.test.ts`). The bridge checks the counts
of nodes and edges before anything is copied, then the code units of the identifiers, counted while
the snapshot is read and read no further once they exceed the budget, then the snapshot, and the
store keeps the snapshot. A string with a lone surrogate, which the bridge would read as U+FFFD,
`api` hands over as `false`, so that it is refused. `updateNode` and `updateEdge` read their patch
the same way, every own key of a plain object, before they look up the item it names, and merge only
the fields the bridge returns as checked. The bridge never formats a refused value into its message.
Graph data that cannot be read at all, such as nodes that are not a list, a list with a hole, a
patch that is no plain object, or a getter that throws, is refused as malformed before the bridge
sees it. That no code of the host application runs in the engine holds while nothing on the page has
patched JavaScript's built-ins, such as a setter on `Object.prototype` or a `Symbol.hasInstance` of
`Uint8Array`, which the generated glue reaches.

## Building blocks

The functional core and its shell follow
[ADR-0028](adr/0028-the-graph-lies-within-a-world.md).

- **Engine** (`crates/engine`) — pure geometry: `geometry` holds edge paths as cubic Bézier curves
  from the connector of a side of one node, the middle of its `top`, `right`, `bottom`, or `left`,
  to that of a side of another, their control points pulled out along each side's outward normal
  ([ADR-0024](adr/0024-one-connector-per-side.md)), their exact bounds, the point and normal at a
  path parameter, and edge-label placement; `positions` the positions buffer and its moves. `graph`
  keeps the loaded graph, node positions and sizes per slot and edges per slot, a rank per node
  slot, a list of the edges at each node slot, a list each of free node and edge slots, and a
  spatial index (`spatial`, a uniform grid each for nodes and edges, with an overflow list for items
  that cover many cells) that loads, additions, and moves keep current and that is built again once
  many items have moved or been added beyond its extent, or the nodes or the edges in use pass twice
  the count it was built for ([ADR-0022](adr/0022-the-engine-edits-its-graph-in-place.md)). Its
  modules under `graph/` follow its concepts: `slots`, the free slots of a kind, one type kept once
  for nodes and once for edges; `nodes` and `edges`, the edits of each; `index`, the grids and the
  one function that holds the rule that builds them again, called after every addition and move, a
  removal building nothing; `hit`, `labels`, and `query`; each with its tests, `tests` with the
  graphs they build and the property tests of the whole graph against a scan, and `budget`, the
  property test of the mesh budget. `add_node` takes the
  free slot freed last, or a new one after the highest, and the next rank, and puts the node into
  the grid in place; a load ranks node `i` as `i`; `add_edge` takes the edge slot freed last, or a
  new one, and puts the edge into the lists of its ends and the grid in place, and `update_edge`
  restyles and re-places one; `remove_nodes` frees the node slots and those of the edges at them,
  `remove_edges` edge slots, and both take the items out of the grids and the lists at the nodes; a
  free slot holds nothing, no query or hit returns it, a rebuild covers only the slots in use, and a
  call that names one refuses it as a slot beyond the graph. Its query returns the slots a rectangle
  meets, node slots in ascending rank, and `hit_at` what a press at a point hits
  ([ADR-0025](adr/0025-the-engine-answers-every-hit-test.md)): the node drawn on top there, the one
  of the highest rank, else the edge in the highest slot within 4 screen pixels of its path as the
  stroke of the level flattens it, the parts of the path far from the point as chords; where the
  shell asks for connectors, at the near and middle level, a connector within 8 screen pixels, of
  the node of the highest rank, comes before them all. At the near level a label whose pill, as the
  labels layer measures and hands it over (`setLabelSize`), holds the point comes before a node;
  `move_label` places a dragged label at the path parameter nearest a point and its distance along
  the normal there. `stroke` flattens the found edges within a tolerance and strokes them into the
  triangles of one mesh, with each edge's colour, dash pattern, and arrowhead, or as thin lines
  alone at the far level of detail; it decides the stroke of each level. A part of a path whose
  control points miss the query's rectangle, grown by the stroke's width, is drawn as its chord, a
  segment that meets the grown rectangle with an end outside it is split where it enters and leaves
  it, so that what the rectangle shows rounds by its distance from the query's origin, and a path is
  subdivided at most 24 levels deep; the mesh of one query holds at most the mesh budget, 2^22
  vertices: each edge's floor, its chord or its arrowhead alone where that is its full mesh, is
  reserved first, edges are meshed in full in slot order while each fits beside the floors of those
  after it, and from the first that does not, every edge is drawn as its floor and the mesh is
  coarsened; its vectors grow by `try_reserve`, so that memory running short coarsens the mesh
  instead of trapping. It depends on no crate that reaches the browser. `graph` keeps each edge's
  path and its bounds as of its last move, so that a query computes no bounds; `graph::slot` is the
  one conversion of a count to slots, which the bridge uses too. Only what the bridge uses is
  public; the rest is private to the crate, so that the `dead_code` lint finds what only tests
  reach.
- **Bridge** — `crates/engine-wasm` holds every WebAssembly export: `loadGraph` checks graph data
  and resolves edge ends to slots, `addNode` checks one node as a load would and returns the slot
  the engine chose for it, `addEdge` checks one edge as a load would, refuses one from a node to
  itself, and adds it between the node slots `api` resolved, `updateEdge` checks a patch of an
  edge's colour, dash, arrowhead, label, and sides as a load checks those fields and restyles and
  re-places the edge, `edgesAt` names the edges at given nodes without removing anything,
  `removeNodes` removes nodes and the edges at them and returns those edges' slots, `removeEdges`
  removes edges, `translate` moves nodes, each as far as keeps it within the world's limit, so that
  every point the engine derives stays within `f32`, `query` takes a rectangle, a level of detail,
  the size of a screen pixel, at most 2^114 world units for a stroke, and how far an edge label's
  pill reaches from its point, and writes the found node slots, the edge-label slots and points (at
  the near level only), the found edge slots, and the edge mesh into buffers the engine owns, the
  label points and the mesh's positions relative to the query's origin, which `originX` and
  `originY` read
  ([ADR-0010](adr/0010-bridge-data-format.md)), and returns the mesh's detail, complete or
  coarsened, and refuses a pixel that is not a finite number above zero as malformed; `drawnEdges`
  computes the ends of the found edges when inspection asks, as they lie then, and `hit` names what
  a press at a point hits, a connector where the shell asks for connectors, a label, a node, or an
  edge by its slot, or nothing, as one generated value, and refuses a pixel as `query` does;
  `setLabelSize` takes the measure of a label's pill, `labelPoint` names where a label lies, and
  `moveLabel` places a dragged label, one dragged beyond the world's limit stopping there, and
  returns its path parameter and offset; it generates the
  type of every problem of graph data the methods of `Comb` throw, `GraphDataProblem`, which `comb`
  exports, and keeps the refusals of the shell's mistakes in types of their own: `TranslateError` of
  `translate`, and `SlotError` of a slot that holds nothing, which the removals, `edgesAt`,
  `setLabelSize`, `moveLabel`, `addEdge`, and `updateEdge` throw. It checks the screen pixel of a
  query and of a hit test in one function. Its crate root holds the exports and their conversions;
  its module `graph_data` reads and checks graph data, the one place that does, each field of an
  edge through one function that a load, `addEdge`, and `updateEdge` call alike
  ([ADR-0028](adr/0028-the-graph-lies-within-a-world.md)); `packages/comb/src/bridge` is the one
  module that imports the WebAssembly package and reads those buffers through fresh typed-array
  views per read ([ADR-0010](adr/0010-bridge-data-format.md)).
- **Store** (`packages/comb/src/store`) — a vanilla Zustand store with the graph's structure, its
  nodes and edges by slot with holes at free slots, which every reader skips, the maps from node and
  edge identifiers to slots, the code units of the identifiers it holds, counted for a node and for
  an edge by one function each and for a load taken as its snapshot counted them, the change the
  last action that changed the graph made, by kind and identifier, the selection, the node under the
  pointer, the connection the user drags, its source, side, the node under the pointer,
  compatibility, and the connector a release connects to, the viewport, a counter for moved
  positions, and a counter for moves of the point a connection is dragged to; no coordinates of
  nodes, edges, or the pointer
  ([ADR-0029](adr/0029-the-store-holds-no-coordinate-each-move-its-counter.md)).
  `GraphView` is its state without the actions, the type the render layer reads.
  `store/viewport.ts` holds the viewport's arithmetic, the transform between world and screen and
  the level of detail of a scale included, for interaction, the scene, `api`'s `fitView`,
  `setViewport`, and `worldPointAt`, and the testing entry; it imports none of them, so the render
  layer takes it from the store, not from interaction.
- **Interaction** (`packages/comb/src/interaction`) — pointer, wheel, and key input into store
  actions and engine moves. `index.ts` dispatches: a press begins the gesture of what it hits, each
  a module of its own behind the `Gesture` of `gesture.ts`, which says how it moves, how it ends at
  a release or at a later press, and whether a change of the graph takes its subject, which ends it
  without a word; `guard.ts` holds the guard every handler runs under once the engine is lost.
  `node-drag.ts` selects a node on press and drags it, `pan.ts` selects an edge on press and pans
  once the pointer has moved more than 4 screen pixels, or clears the selection on the empty canvas
  and pans; `index.ts` zooms around the pointer and sets the cursor over what a press would hit;
  `connect.ts` begins a connection on a press on a connector, where `CombOptions.canConnect` is set,
  follows the pointer with it, marks compatible the connectors of a node the source does not reach
  yet, and proposes the edge on a release over one, through the connection `api` hands it;
  `delete.ts` makes the canvas focusable and, on Delete or Backspace, names what deleting the
  selection would remove, a node with the edges the engine names at it (`edgesAt`) before anything
  is removed, and hands it to the deletion `api` hands it; neither asks a veto itself;
  a key held down or pressed with Control, Alt, or Meta deletes nothing beyond its first press. A
  connection's source and what it is over are the store's, written only where they change; the
  world point it is dragged to is interaction's `pointer`, which `attachInteraction` returns, and a
  move signals it with the store's `pointerMoved`, as a drag of a node signals its positions; its
  gesture ends it at a load or a removal of its source. `label-drag.ts`: a press on a label, at the
  near level, selects its edge and drags the label, held where it was grabbed, which the engine
  places on every move; its release, or a later press, records `labelMoved` once, and a load, a
  removal of its edge, or a label the host cleared ends the drag. A drag that moved its node records
  `nodeMoved` once, when the pointer is released on the canvas or outside it; a load ends a drag.
  The engine's `hit` says what the pointer is on, at the level of detail of the scale; node views
  and edges take no events.
  `targetAt` of `gesture.ts` is the one hit test: `attachInteraction` asks it from the store's
  viewport, connectors only where `CombOptions.canConnect` is set, as `hitAt`, which the gestures'
  `Context` carries, for the press, the hover, and every move of a connection, and returns it, for
  the testing entry, beside the `pointer` of a connection and the function that detaches the input.
- **Render** (`packages/comb/src/render`) — the PixiJS scene (`scene.ts`), which imports nothing
  from interaction: a `world` render group with the layers `EdgesContainer` (`edges.ts`),
  `NodeParticles` (`particles.ts`), `NodesContainer` (`nodes.ts`), `LabelsContainer` (`labels.ts`),
  and `ConnectorsLayer` (`connectors.ts`), with the connectors of the node under the pointer and,
  while the user connects, of the source and the node under the pointer, and an `overlay` with the
  line of the connection being dragged, to the pointer `api` hands each render from interaction
  ([ADR-0027](adr/0027-nodes-bound-by-rank.md)); `bindings.ts`
  is the pool of views the nodes and labels layers bind to slots, keeping the layer's children in
  the order a render binds them. The scale chooses the level of detail: near (from 0.6) draws node
  views and edge labels, middle (from 0.3) node views alone, and far nodes as particles of one
  `ParticleContainer` (`render/particles.ts`) and edges as lines one pixel wide. A render queries
  the engine for the viewport grown by the culling margin and binds pooled node views and edge-label
  views to exactly the slots it found, node views and particles in the order of the nodes' ranks,
  which the query returns, edge labels in slot order; while the viewport stays within what it last
  queried, that rectangle within the viewport grown by twice the culling margin, at about its scale
  and the same level of detail, and the graph and the selection are unchanged, a render moves the
  world alone. The world stands at the screen point of the last query's origin, the edges, labels,
  and connectors at (0, 0) in it, drawn less the origin, the nodes and particles at minus the
  origin, so that the GPU sees no far coordinate of edges, labels, and node views. `EdgesContainer`
  (`render/edges.ts`) draws the edge mesh with a shader that leaves out the gaps of dash patterns;
  on the Canvas 2D renderer a host application opts into
  ([ADR-0018](adr/0018-webgl2-or-an-opted-in-canvas-fallback.md)), which runs no shader, `EdgeFill`
  (`render/edges-canvas.ts`) takes its place, builds no mesh, and fills the same triangles into one
  `Graphics`, one fill per run of one colour, dash patterns solid. Not built yet: the node content
  of [ADR-0013](adr/0013-node-content-model.md).
- **API** (`packages/comb/src/api`) — `api/index.ts` imports `pixi.js/unsafe-eval` before PixiJS, so
  that no PixiJS renderer on the page generates code with eval
  ([ADR-0020](adr/0020-pixijs-without-eval.md)); `createComb`, which takes the engine's WebAssembly
  from the host application as `engine` and refuses with an `EngineSourceError` where it is missing,
  a string, `URL`, or `Request`, or none of a `Response`, a module, and the bytes (`api/engine.ts`,
  [ADR-0019](adr/0019-the-host-hands-comb-its-engine.md)), before it touches the host element, and
  with a `RendererUnavailableError` where PixiJS finds no WebGL2 unless `allowCanvasFallback` lets
  it draw on Canvas 2D (`api/renderers.ts`), and paints the canvas in `background`; and the `Comb`
  it returns: the graph data (`load`, `updateNode`, `addNode`, `addEdge`, `updateEdge`,
  `removeNodes`, `removeEdges`), read once into a snapshot (`api/snapshot.ts`) and handed to the
  engine by `api/editors.ts`, which also gives interaction the user's connection and deletion, each
  after its veto, `CombOptions.canConnect` or `CombOptions.canDelete`, the
  viewport (`fitView`, `setViewport`, `viewport`, and `worldPointAt`, the world point
  under a point of the page, which needs no engine), the events to the host application (`onChange`,
  `onSelectionChange`, `onEngineLost`), and `destroy`; `onChange` delivers each change the store
  records as a `GraphChange`
  ([ADR-0030](adr/0030-a-veto-that-changes-the-graph-ends-its-gesture.md)), its positions read
  from the engine's buffer, synchronously from one subscription to the store that tells a change
  before the selection it cleared (`api/changes.ts`); `whenRendered` resolves once a change is
  drawn, with one render per animation frame scheduled by `api/frames.ts`. `api/scenes.ts` is the
  one way from a `Comb` to its scene and to the hit test its presses ask, for the testing entry.
- **Testing entry** (`comb/testing`, `packages/comb/src/testing.ts`) — `inspect` returns what the
  scene draws, the text of the titles and labels drawn included, the connectors drawn with where
  each is centred and how often the layer drew them anew, and the size and detail of the edge mesh,
  which the host application is not told; `viewport` and `renderCount`, cheap enough for every
  frame, return its transform and how often it rendered; `screenPoint` and `visibleRect` apply the
  scene's transform between world and screen; `hitKind` names what a press at a screen point hits,
  asking interaction's hit test from the viewport a press reads, which is the drawn one once
  `whenRendered` resolves, connectors only where the Comb lets the user connect; `isDrawn` finds
  whether one node or edge is drawn without building every drawn view, as `inspect` does;
  `showLayers` hides layers for a reference image;
  `sceneNumbers` gives the numbers the scene draws by (where the levels of detail begin, the culling
  margin, the label reach, the rescale); `work` counts what the canvas did: GPU buffers created and
  allocated, bytes uploaded, those of the edge mesh among them, and texture uploads, counted at the
  WebGL context from its first call, resizes of the edge mesh's buffers, and views the pools made,
  and refuses with an `UncountedRendererError` where the canvas draws without WebGL;
  `edgeVertices` gives the screen point of every vertex of the edge mesh as its shader computes it
  in `f32`; for tests, the benchmark, and tooling.
  Its shape follows the scene and is outside the stable interface of `comb`.
- **Example** (`examples/metric-tree`) — a host application with a metric tree and an HTML sidebar
  (G-9) that edits the selected node's title or the selected edge's colour, dash, arrowhead, and
  label, with a palette whose kinds HTML drag and drop puts onto the canvas, where the example adds
  a node centred on `worldPointAt` of the drop (G-1); it keeps its own copy of the graph from every
  kind of change `onChange` tells, in one table by kind, the sidebar's edits following from the
  changes Comb tells, and `window.exampleGraph` hands a browser test that copy; it names each edge
  the user connects after its ends, and hands its vetoes to `window.canConnect` and
  `window.canDelete` where a browser test sets them; `?connect=none` gives Comb no `canConnect`;
  `?copies=` sets its size, the copies lie in a grid about as wide as tall, and it reports its load
  time as `window.loadReport`; `?fallback=canvas` allows the Canvas 2D fallback; it fetches the
  engine file Vite emits for its `comb/engine.wasm?url` import and hands over the promise of the
  response, or with `?engine=response`, `module`, `bytes`, or `view` that form; `window.createComb`
  and `window.engineUrl` let a browser test make a second Comb in a host element of its own,
  `window.useGraph` loads a graph as the example's own, and the functions of `comb/testing` stand on
  `window`, bound to its Comb.
- **Benchmark** (`bench/run.ts`) — the example at 50,010 nodes in Chromium, measuring the time to
  the first frame and p95 frame times of drag, pan, and zoom over the frames Comb rendered, of
  edits one a frame, a node and an edge added and removed again, and of a pan where the near and
  the middle level begin, each gesture checked for its effect (Q-1, Q-2),
  served from the example's production build by `vite preview` on port 4173, in a Chromium
  started by `bench/chromium.ts`.
  After the first frame and before the gestures it times the reference workload of
  `bench/reference.ts` in the same page, which uses the browser's JavaScript, WebAssembly, and
  WebGL2 and none of Comb's code. `bench/compare.ts` compares the median of several runs with
  the baseline of the runner's kind, the CPU model the run records, in `bench/baselines/`, with a
  margin of 25 %, refuses a run on a kind without a baseline, and refuses a run whose reference
  differs from its kind's baseline by more than 25 % in a part; a kind's baseline is the median of
  three runs on a GitHub runner of that kind on `main`; the **Benchmark** workflow
  (`.github/workflows/benchmark.yml`) runs the benchmark three times and compares on a GitHub
  runner, weekly and on demand.
- **Mutation testing** (`.github/workflows/mutation.yml`) — cargo-mutants mutates `crates/engine`
  on a GitHub runner, weekly and on demand; `scripts/check-mutants.sh` compares the surviving
  mutants with `crates/engine/mutants-missed.txt` by file, function, and replacement, and fails
  on a survivor the list does not name, and on a run that caught none (ADR-0008).

**Test pattern:** Rust unit tests beside the code they test (`#[cfg(test)]`); a property test of the
bridge crate's validation (`crates/engine-wasm/src/properties.rs`, proptest) that feeds it 10,000
random batches per run against a brute-force oracle, and one of the mesh budget
(`crates/engine/src/graph/budget.rs`) that queries random graphs of long edges with the budget
lowered; Bun tests beside their module as `*.test.ts`, the bridge's against the built WebAssembly
module, the lint's rules for Comb's library sources in `packages/comb/src/lint.test.ts`, and those
of `bench/compare.ts` and `bench/chromium.ts` beside them; browser tests under `examples/*/e2e`, a
file for the golden path and one for each concern they verify, sharing their helpers through
`e2e/shared.ts` (a graph loaded as the example's own through `useGraph` with what Comb tells
recorded, the node size the example's source states, and the page point of a world point, a click
and a drag there), run by Playwright on Bun against the example, reading what is drawn through
`comb/testing` rather than pixels, apart from one reference image of the edges alone.

The Bun tests and the browser tests on the development server run the bridge in test mode, which
grows the engine's memory before each of its calls, so a view kept across a call reads empty. The
browser tests serve the example in Vite's `test` mode for it, on port 5174, and assert it through
`testMode()` of `comb/testing`; the bundle check fails a bundle that carries it. In test mode the
engine traps on demand: `trapNextCall()` of `comb/testing` arms an export the bridge crate carries
only when built with its feature `test-mode`, and the next call of an `Engine` traps. The example's
Vite configuration hands that engine, from `packages/comb/wasm/test-mode/`, over in place of
`comb/engine.wasm` on the development server in test mode; the Bun test of the trap reads it in a
process of its own (`packages/comb/src/bridge/trap.fixture.ts`), since a trap loses the engine for
the process; and the bundle check fails an engine file that carries the export.

In test mode the example's Vite configuration also sends every response with the Content Security
Policy of Q-6, `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'`, from the development
server and from `vite preview`, so every browser test runs under it. `e2e/policy.spec.ts` records
every request and `securitypolicyviolation` while the graph loads, is panned, and is zoomed, once
on the development server and once, tagged `@built`, on the example's production build, which
`vite preview` serves on port 5175; that build runs without test mode, as a host application ships
it. Playwright and the benchmark start headless Chromium without the displays a Dev Container
forwards, so WebGL2 runs on SwiftShader instead of PixiJS falling back to Canvas 2D.

## How it runs

**Dragging a node.** `interaction` turns the pointer delta into world units and calls
`bridge.translate`, which moves the slot in the engine's positions buffer and recomputes the
node's edges and their place in the spatial index; it then bumps the store's `positionsVersion`.
The store notifies the scene, which renders once per animation frame: it queries the engine for
the viewport grown by the culling margin, binds node views and edge-label views to the slots
found, and uploads the edge mesh the query built, so edges and labels follow the node in the
same frame.

**Editing.** A method of `Comb` that changes the graph runs through one function of
`api/editors.ts`, which holds the order: it refuses once the engine is lost, reads the input once,
whole, into a snapshot, refuses what the store's map shows as it stands after the read, checks the
code units of identifiers the graph would hold, and hands the snapshot to the bridge, which checks
it and has the engine add, change, or remove the items in place; the store then takes the result and
records the change, and `api`, subscribed to the store, delivers it to `onChange` as a `GraphChange`
before the call returns, and the next frame draws it. What the bridge refuses of the data becomes a
`GraphDataError`; a `SlotError`, the shell's own mistake, an `Error` naming the slot. A user's
connection and deletion, which `interaction` hands to `api/editors.ts`, are asked of their veto
there, in one place: only an identifier `canConnect` returns connects and only `true` from
`canDelete` deletes, and a veto during whose call Comb tells a change to `onChange` ends its gesture
with nothing done and no error, whatever it returned
([ADR-0030](adr/0030-a-veto-that-changes-the-graph-ends-its-gesture.md)). Then they run through the
same function, the deletion through `removeNodes` where its `Deletion` names nodes, else through
`removeEdges`, recorded as `by: "user"`, which every store action whose change may be either's
requires; a dragged node or label writes the engine alone while it moves and records `nodeMoved` or
`labelMoved` once, at release.

**Panning and zooming.** `interaction` sets the store's viewport. While the viewport stays inside
the rectangle the scene last queried, and that rectangle within the viewport grown by twice the
culling margin, at a scale within a factor of 1.25 of the one it queried at and the same level of
detail, the world moves alone; beyond that the scene renders as above, so what leaves the
viewport and its margin returns its views to the pools and what enters takes them from there. The
mesh is flattened within a quarter pixel at the current zoom, so zoomed out it has fewer points. A
resize of the canvas renders too.

**Building.** `bun run build:engine` compiles `crates/engine-wasm` with wasm-pack into
`packages/comb/wasm/` (generated, not tracked), with glue that has no default path to the engine
file (`omit-default-module-path` in its `Cargo.toml`); the library imports the glue from there,
`comb` exports the file `wasm/engine_bg.wasm` as `comb/engine.wasm`, and Vite serves the example
from source. It compiles the crate again with the feature `test-mode` into
`packages/comb/wasm/test-mode/`, for the tests, with the same glue. `bun run build:lib` bundles
the library without PixiJS into `packages/comb/dist/`, without the WebAssembly, which the host
application hands over (ADR-0019); that bundle and the engine file are what the budget of Q-3
measures, and the bundle check fails a bundle that inlines the engine.

**Loading the engine.** `createComb` settles the host application's promise, if it handed one
over, refuses what is missing, would be fetched, or is none of a `Response`, a module, and the
bytes, and passes the rest to the glue's initialiser, which compiles a `Response` while it streams
and instantiates a module or bytes. The glue instantiates once per page and returns that instance
to every later call, so a later `createComb` checks its engine but does not use it. The Bun tests
create the bridge from the bytes with `createBridgeSync`.

**Losing the engine.** The bridge passes every call of the engine through a guard: a
`WebAssembly.RuntimeError`, or the glue's refusal of an object a trapped call left borrowed, marks
the engine lost for the page and calls the listeners of `onEngineLost` once; from then on the
guard, `createComb`, and the calls of `Comb` that need the engine throw an `EngineLostError`
(ADR-0021). The frame that finds the engine lost stops rendering and resolves its waiters, and
input handlers do nothing, so no trap escapes as a page error.

**Holding the shape.** `scripts/check-code.sh`, which `scripts/check-all.sh` runs and the **Checks**
workflow (`.github/workflows/checks.yml`) runs on every pull request, runs the structural, the
dependency, and the overview checks below with their self-tests and the self-test of the engine
check, then the build, the lint, and the tests, then the bundle check with its self-test.
`scripts/check-engine.sh`, which `bun run test`, `bun run dev`, and the bundle check run first,
fails when `engine_bg.wasm` of `packages/comb/wasm/` or of `packages/comb/wasm/test-mode/` is
missing or older than a file under `crates/` other than those no build reads (the list of surviving
mutants, proptest's regressions, a run of cargo-mutants, editors' swap files), `Cargo.toml`, or
`Cargo.lock`, naming the file and `bun run build:engine`. `scripts/check-structure.sh` fails when
the engine's core names or, through `Cargo.lock`, reaches a crate that touches the browser, the
clock, randomness, or I/O, when a module other than the bridge imports the WebAssembly package, when
the render layer reaches the store instead of the action-free `GraphView`, or when an example
imports past the library's entries and its engine file (ADR-0028, ADR-0019), and when the render
layer names PixiJS's `Text`, `HTMLText`, or `SplitText` or the edges layer a `Graphics` (ADR-0027),
and when its Canvas 2D fallback names `Graphics` outside its imports and its one field (ADR-0018);
it also fails a render file that imports from interaction by a relative path, a boundary no ADR
decides, which the check holds as its own rule and this overview describes.
`scripts/check-overview.sh` fails, naming each, where this overview holds no code span of its own
for a method or property of the `Comb` interface, an option of `CombOptions`, or a function or
constant `comb/testing` exports (ADR-0001), and where it reads no names from one of those sources.
`scripts/check-bundle.sh` builds the library and fails when its gzipped JavaScript and the engine
file reach the 300 kB of Q-3, when no engine file is measured, when the JavaScript inlines the
engine (ADR-0019), and when the bundle carries either seam of the bridge's test mode, each by a mark
of its own the bridge's source names once, `DETACHING_MARK` in the message of `detaching` and
`TRAP_EXPORT`, the name of the trap's export (ADR-0010, ADR-0021); it fails too when it does not
recognise each in the library built in test mode, and the trap in the engine of
`packages/comb/wasm/test-mode/`, and when that engine's generated glue differs from the production
engine's, which the example hands it over with. The benchmark and the browser test of the built
example fail where `testMode()` says the build runs the bridge in test mode.
`scripts/check-dependencies.sh` fails on a lockfile of another package manager beside `bun.lock`
(ADR-0008), on tsify's default or `json` features or `serde_json` in the bridge crate (ADR-0010), in
whatever form the entry takes, and on a listed state library other than zustand in the library's
dependency lists (ADR-0029). The type checker does the rest for the render layer: `GraphView` has no
action to call. ESLint forbids the DOM markup sinks (Q-5) and `eval`, implied eval, and `new
Function` (Q-6) in Comb's library sources, outside its tests.
