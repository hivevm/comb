# ADR-0012: A virtualized scene graph with culling by the engine and three levels of detail

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** `packages/comb/src/render/`, and the exports of `crates/engine` and `crates/engine-wasm` that answer spatial queries and compute edge geometry

## Context

The specification asks for a PixiJS scene graph on WebGL2 that supports culling and draws node
backgrounds and edges in batches ([Constraints](../SPECIFICATION.md#constraints)), for nothing
outside the viewport to be drawn (G-7), for 60 fps with 50,000 nodes and 50,000 edges (Q-1), and
for such a graph to open within 1 s (Q-2).

PixiJS v8 turns culling off by default and says it is often better done at the application
level. Its guide recommends `BitmapText` over `Text` for text that changes, because `Text` is
redrawn to a canvas and uploaded to the GPU on every change. It batches `Graphics` only up to 100
points. A `ParticleContainer` draws hundreds of thousands of particles, which have position,
scale, rotation, tint, and alpha but no children and no events. A render group moves the
transform of a container to the GPU, so panning and zooming it costs little CPU.

Culling alone does not hold Q-1. Zoomed out far enough, all 50,000 nodes are in the viewport at
once, and a display object with full node content for each of them is too much for the CPU and
for the load time of Q-2. The engine already owns the coordinates (ADR-0010) and is the place for
a spatial index (ADR-0009).

The edge mesh grows with what the engine flattens, not with what is visible. A path is
subdivided into up to 2^12 segments, and a query that meshes every edge it finds whole, into
vectors that grow without bound, runs WebAssembly out of memory with graph data the bridge
accepts: two nodes, one at (0, 0) and one at (-1e7, 3e6), with 20,000 edges between them, trap
with `unreachable` at the first frame after zooming to a scale of 4, inside the animation frame,
where the host application cannot catch it; 10,000 such edges at a pixel of 0.25 world units
take 3.7 GB before they trap. A load may hold up to 1,000,000 edges (ADR-0009). Rust's standard
collections abort when an allocation fails, which on WebAssembly is a trap; `try_reserve` returns
the failure instead. Q-4 asks for edge paths that deviate by at most 0.5 px from a reference
computation at every zoom level, and the viewport lies inside the rectangle the scene last
queried.

## Decision

We will create PixiJS display objects only for the nodes, edge labels, and connectors the engine's
spatial index reports inside the viewport, take them from pools and return them there, draw all
edges of a layer as one mesh from the edge geometry the engine computes within a budget of
vertices per query, and choose by zoom between three levels of detail.

- **Layers:** a `world` container with `isRenderGroup`, holding in drawing order `edges`,
  `particles`, `nodes`, and `labels`; an `overlay` outside `world` in screen coordinates. A layer
  joins the list with the change that builds it, such as a grid or the connectors.
- **Culling:** `render` asks the engine for the slots that meet the viewport grown by a culling
  margin of 128 screen pixels, and binds pooled display objects to exactly those, in slot order.
  While the viewport stays inside the rectangle it last queried, that rectangle reaches at most
  twice the margin beyond the viewport, the scale stays within a factor of 1.25 of the one it
  queried at, and the graph and the selection are unchanged, a render moves the world alone
  without a query. PixiJS's own culling stays off.
- **Edges:** the engine owns the stroke. It flattens every edge it finds within a quarter pixel at
  the current zoom inside the query's rectangle and tessellates it into the buffers of one mesh
  (ADR-0010): per vertex its position, its distance along the path, its colour, and its dash
  pattern, and an arrowhead whose tip is the edge's end. `edges` uploads them into one mesh whose
  shader only leaves out the gaps of dash patterns, never a `Graphics` per edge. Appearance the
  host application adds to edges extends the engine's stroke.
- **The rectangle:** a part of a path whose control points have a bounding box that misses the
  query's rectangle grown by the stroke's width is drawn as its chord. The curve and the chord lie
  in the hull of those control points, so neither the chord nor its stroke reaches into the
  rectangle, and each edge in the viewport is drawn within a quarter pixel at the scale queried,
  within Q-4 until the next query. Past a chord, the distance along the path advances by the
  chord's length.
- **Mesh budget:** the mesh of one query holds at most 4,194,304 (2^22) vertices, and so at most
  three times as many indices. Each edge the query found has a floor: its chord, four vertices, in
  its colour and dash pattern, without an arrowhead. In slot order, edges are meshed in full while
  each fits beside the floors of the edges still to come; the flattening of an edge stops once it
  passes the room left, and from the first edge that does not fit, it and every later edge are
  drawn as their chords, unflattened. The budget is the floors of a load at the limit of
  1,000,000 edges (ADR-0009), 4,000,000 vertices, taken to the next power of two, the size the
  shell's arrays grow to anyway; it is twelve times the largest mesh measured of the benchmark's
  graph (Sources), which never reaches it. So every edge found is drawn at every viewport while
  memory lasts, and the budget follows the limit when the limit changes. The mesh's vectors grow
  by `try_reserve`, never beyond the budget; the floors are reserved before the first edge is
  meshed, and an allocation that fails ends full meshing as the budget does, or, where it fails
  for the floors themselves, leaves the mesh without edges. A query returns the detail of its
  mesh: *complete*, or *coarsened* where an edge was drawn as its chord or left out for the
  budget or for memory. The shell draws the mesh as it comes and reports the detail through
  inspection, not to the host application.
- **Q-4:** the rectangle and the mesh budget rest on a drafted change of Q-4, which a ticket under
  `docs/plan/` carries until the maintainer lands it: Q-4 holds for everything the viewport
  shows, wherever the edge mesh is not coarsened. They hold only once that change lands.
- **Text:** every text on the canvas is `BitmapText`.
- **Levels of detail:** *near* draws the full node content (G-10) and edge labels; *middle* draws
  each node's box and title without the rest of its content; *far* draws nodes as particles of
  one `ParticleContainer`, edges as plain lines one pixel wide, and no text. The thresholds follow
  legibility: near from the scale at which edge labels are 7 pixels tall (0.6), far below the
  scale at which titles fall under 4 pixels (0.3). The benchmark on the reference machine checks
  that each level holds Q-1, and a threshold moves where one does not.
- **Hit testing:** the engine answers which node is drawn on top at a point from the same spatial
  index, at every level; node views take no events.

**Out of scope:** the model of node content and how its elements are laid out.

## Alternatives considered

- **PixiJS's own culling with `cullable` on every object** — no engine query, but every one of
  50,000 nodes then exists as a display object with its content, against Q-2, and the guide
  itself recommends culling at the application level.
- **Culling without levels of detail** — simpler, but zoomed out, the viewport holds the whole
  graph, and culling removes nothing.
- **A `Graphics` per visible edge** — the simplest start, but `Graphics` batch only up to 100
  points, and zoomed out, every edge is visible.
- **`Text` instead of `BitmapText`** — sharper typography, but a canvas draw and a texture upload
  for every change, for every node.
- **Leave edges out beyond the budget** — the mesh stays smaller still, but an edge the graph
  holds vanishes from the viewport, and the user cannot tell a missing edge from none; a chord
  still shows that the edge is there.
- **Coarsen everything uniformly** — raise the tolerance of the whole query until the mesh fits:
  one look for every edge, but once a query passes the budget every visible edge strays beyond
  0.5 px, not only those past it, and the query flattens its edges again for each try.
- **No budget, the rectangle alone** — the depth of subdivision bounds what one edge costs, about
  8,200 vertices, and the rectangle what it costs zoomed in, but neither bounds what a query
  costs: 1,000,000 edges through one viewport still grow the mesh until memory runs out.
- **A budget measured from the benchmark, such as 2^20 vertices** — three times the largest mesh
  of the benchmark's graph, and a quarter of the memory, but the floors of more than 262,144
  edges found in one rectangle exceed it, so past that the engine would have to leave edges out
  or break the budget.

## Sources / Prior art

- PixiJS v8, *Performance tips* — <https://pixijs.com/8.x/guides/concepts/performance-tips>:
  culling off by default and better at the application level, batching limits, `BitmapText`.
- PixiJS v8, *Particle container* —
  <https://pixijs.com/8.x/guides/components/scene-objects/particle-container>.
- PixiJS v8, *Render groups* — <https://pixijs.com/8.x/guides/concepts/render-groups>.
- npm `pixi.js` 8.22.0, MIT (checked 2026-10-17).
- Rust standard library, `Vec::try_reserve` —
  <https://doc.rust-lang.org/std/vec/struct.Vec.html#method.try_reserve>, and
  `std::alloc::handle_alloc_error` —
  <https://doc.rust-lang.org/std/alloc/fn.handle_alloc_error.html>: a failed allocation aborts by
  default, `try_reserve` returns it as an error.
- The largest mesh found of the benchmark's graph, 50,010 nodes and 50,010 edges in a canvas of
  1440 by 900 pixels: 346,736 vertices and 740,148 indices, at the far level at scales of 0.016
  to 0.018, where all edges are in view; at the middle and near levels, 5,912 and 2,461 vertices.
  Measured on 2026-10-22 from the example's production build in headless Chromium, through
  `edgeMesh` of `inspect()`, at 29 scales from 0.0005 to 4, each at the graph's centre and at
  five to nine further centres drawn with a fixed seed.

## Consequences

- Positive: the number of display objects follows what is visible at the current level of detail,
  not the size of the graph, which serves Q-1 and Q-2.
- Positive: panning and zooming move one render group on the GPU.
- Positive: no valid graph within the limits of a load runs a query's mesh out of memory, and a
  query zoomed in meshes only what crosses its rectangle.
- Negative / trade-offs: pooling means a display object is bound to a different node from frame
  to frame; any state kept on it outside the binding is a bug.
- Negative / trade-offs: a custom edge mesh and its shader are more code than `Graphics`, and
  `BitmapText` renders less crisp text than `Text` at some sizes.
- Negative / trade-offs: between queries, bound objects may reach up to twice the culling margin
  beyond the viewport, which G-7's wording does not yet allow for.
- Negative / trade-offs: at the budget, the mesh takes up to 151 MB in the engine, 24 bytes of
  attributes and up to 12 bytes of indices per vertex, and about as much again in the shell's arrays
  and the GPU's buffers. Such a frame does not hold Q-1; the budget bounds memory, and with the
  flattening stopped at the room left, the work of a query, but not to a frame's time.
- Negative / trade-offs: an edge drawn as its chord for the budget strays beyond 0.5 px and draws
  no arrowhead. The drafted change of Q-4 allows that in a coarsened mesh, and limits Q-4 to what
  the viewport shows; until it lands, Q-4 asks for 0.5 px at every zoom level, the specification
  wins, and this decision conflicts with it.
- Negative / trade-offs: a chord is shorter than the part it stands for, so where an edge leaves
  the rectangle and comes back, its dash pattern inside may shift when a query moves the chord.
- Negative / trade-offs: which edges keep full detail past the budget follows slot order, not
  what the user looks at.
- Follow-ups: the model of node content; whether the host application learns that a mesh was
  coarsened, which would change the public interface; ordering the edges past the budget by their
  nearness to the viewport's centre.

## Enforcement

A Playwright test loads a known graph, pans so that a known set of nodes, edges, and labels lies
outside the viewport, and asserts that none of them is bound to a display object and that the
number of display objects stays below a bound independent of the graph's size; it repeats this at
each level of detail. A check fails when a file in `packages/comb/src/render/` creates a `Text`
or a `Graphics` per edge. Each cites this ADR with `Verifies: ADR-0012`, and the first also
`Verifies: G-7`.

A property test of the engine generates graphs of long edges and of many edges between few nodes,
and queries them at random rectangles, scales, and levels, with the budget lowered for the test; it
asserts that the mesh holds at most the budget's vertices and three times as many indices, that
every edge found is drawn, that a query whose full mesh fits reports it complete and one whose full
mesh does not fit reports it coarsened, and that a complete query draws each edge within a quarter
pixel inside its rectangle; removing the budget turns it red. A test in `crates/engine-wasm` asserts
that four vertices for each of the most edges a load may hold fit the engine's budget. A Playwright
test loads the graph of two nodes at (0, 0) and (-1e7, 3e6) with 20,000 edges between them, sets the
viewport to a scale of 4, and asserts that no page error occurs, that the frame is drawn, that
inspection reports the mesh complete, and that a valid graph loaded afterwards draws; removing the
rectangle turns it red with the trap. Each cites `Verifies: ADR-0012, Q-7`, and the property test
also `Verifies: Q-4`.

**Not mechanically decidable:** the branches where `try_reserve` fails; provoking them needs an
allocator that fails on demand, which the engine's tests do not have, so review holds that they
draw chords and never trap.
