# ADR-0012: A virtualized scene graph with culling by the engine and three levels of detail

- **Status:** ⚪ superseded by [ADR-0027](0027-nodes-bound-by-rank.md)
- **Date:** 2026-10-24
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

The edge mesh grows with what the engine flattens, not with what is visible. A path subdivided
into up to 2^12 segments, and a query that meshes every edge it finds whole, into vectors that
grow without bound, run WebAssembly out of memory with graph data the bridge accepts: two nodes,
one at (0, 0) and one at (-1e7, 3e6), with 20,000 edges between them, trap with `unreachable` at
the first frame after zooming to a scale of 4, inside the animation frame, where the host
application cannot catch it; 10,000 such edges at a pixel of 0.25 world units take 3.7 GB before
they trap. A load may hold up to 1,000,000 edges (ADR-0009). Rust's standard collections abort
when an allocation fails, which on WebAssembly is a trap; `try_reserve` returns the failure
instead.

Q-4 asks for edge paths that deviate by at most 0.5 px from a reference computation at every zoom
level, for everything the viewport shows within Q-4's bounds of single precision (paths within 2^21
px of the viewport, dashes up to 2^21 px along a path), and allows a coarsened edge mesh where the
mesh budget or memory runs short; the rectangle and the mesh budget below rest on Q-4 as it reads.
The viewport lies inside the rectangle the scene last queried. Why the rectangle and the budget hold
what they claim:

- **The rectangle.** A curve and its chord lie in the hull of the curve's control points, so where
  their bounding box misses the rectangle grown by the stroke's width, neither the chord nor its
  stroke reaches into the rectangle, and each edge in the viewport is drawn within a quarter pixel
  at the scale queried, within Q-4 until the next query. Split where it enters and leaves the grown
  rectangle, no vertex of a segment that meets the rectangle lies farther from it than the grown
  rectangle reaches, so what the rectangle shows rounds by its distance from the query's origin
  (ADR-0010), however far the segment's ends lie. A depth of 24 keeps the quarter pixel in the
  rectangle for an edge from (0, 0) to (-1e8, 3e7); the rectangle and the mesh budget, not the
  depth, bound what an edge costs.
- **Sixteen split points.** The flattened points lie on the curve, and each split point marks a
  change of side of one of the four lines that bound the grown rectangle between two of them, the
  entry and the exit of one segment by different lines. A cubic crosses each line at most three
  times, and the base of the arrowhead, off the curve, may add one more per line: sixteen. Counted
  against the room left as every flattened point is, a rounding that adds more cannot break the
  budget, and the floors and the budget stay as they are.
- **The budget's size.** The floors of a load at the limit of 1,000,000 edges (ADR-0009) are
  4,000,000 vertices; the next power of two is the size the shell's arrays grow to anyway. It is
  twelve times the largest mesh measured of the benchmark's graph (Sources), which never reaches
  it, nor would with 32 more vertices for each of its edges. So every edge found is drawn at every
  viewport while memory lasts.

## Decision

We will create PixiJS display objects only for the nodes, edge labels, and connectors the engine's
spatial index reports inside the viewport, take them from pools and return them there, draw all
edges of a layer as one mesh from the edge geometry the engine computes within a budget of
vertices per query, and choose by zoom between three levels of detail.

- **Layers:** a `world` container with `isRenderGroup`, holding in drawing order `edges`,
  `particles`, `nodes`, and `labels`; an `overlay` outside `world` in screen coordinates. A layer
  joins the list with the change that builds it, such as a grid or the connectors.
- **The world at the query's origin:** `world` stands at the screen point of the last query's origin
  (ADR-0010), computed in `f64`; the layers that draw from the query's relative streams, now `edges`
  and `labels`, stand at its (0, 0), and those placed by node positions, now `nodes` and
  `particles`, at minus the origin. The GPU's `f32` then sees only distances from the origin for the
  edges, the edge labels, and the node views, whose vertices PixiJS computes in `f64` within the
  world; the particles of the far level, whose shader takes their container's whole transform, keep
  the rounding they had. A render that moves the world without a query keeps the origin of the query
  it drew.
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
  query's rectangle grown by the stroke's width is drawn as its chord; past a chord, the distance
  along the path advances by the chord's length. A segment of the flattened path that meets the
  grown rectangle with an end outside it is split where it enters the grown rectangle and where it
  leaves it, once the arrowhead has cut the path's end. The parts outside are drawn as chords and
  the edge stays complete; the split points lie on the segment, so the distance along the path runs
  on through them unbroken. Subdivision goes at most 24 levels deep, up to 2^24 segments of an
  edge, and a pixel that is not a finite number above zero is refused before any edge is flattened.
- **Mesh budget:** the mesh of one query holds at most 4,194,304 (2^22) vertices, and so at most
  three times as many indices: the floors of a load at its limit, taken to the next power of two,
  and the budget follows the limit when the limit changes.
  - Each edge the query found has a floor: the smaller of its chord, four vertices, in its colour
    and dash pattern, without an arrowhead, and its full mesh where that is its arrowhead alone,
    found within its first 64 flattened points.
  - In slot order, edges are meshed in full while each fits beside the floors of the edges still to
    come; the flattening of an edge stops once it passes the room left, and from the first edge
    that does not fit, it and every later edge are drawn as their floors, unflattened.
  - The split adds points to an edge's full mesh, not to its floor, which stays its chord or its
    arrowhead unsplit: at most two per segment and sixteen per edge, so at most 32 vertices and 96
    indices, counted against the room left as every flattened point is.
  - The mesh's vectors grow by `try_reserve`, never beyond the budget; the floors are reserved
    before the first edge is meshed, and an allocation that fails ends full meshing as the budget
    does. Where the floors of the edges found exceed the budget, which takes more than 1,048,576
    edges in one query, or cannot be allocated, the mesh holds no edges.
  - A query returns the detail of its mesh: *complete* where every edge it found is meshed in
    full, or *coarsened* where an edge was drawn as its chord or left out for the budget or for
    memory. The shell draws the mesh as it comes and reports the detail through inspection, not to
    the host application.
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

The scene:

- **PixiJS's own culling with `cullable` on every object** — no engine query, but every one of
  50,000 nodes then exists as a display object with its content, against Q-2, and the guide
  itself recommends culling at the application level.
- **Culling without levels of detail** — simpler, but zoomed out, the viewport holds the whole
  graph, and culling removes nothing.
- **A `Graphics` per visible edge** — the simplest start, but `Graphics` batch only up to 100
  points, and zoomed out, every edge is visible.
- **`Text` instead of `BitmapText`** — sharper typography, but a canvas draw and a texture upload
  for every change, for every node.

What an edge and a query cost:

- **Leave edges out beyond the budget** — the mesh stays smaller still, but an edge the graph
  holds vanishes from the viewport, and the user cannot tell a missing edge from none; a chord
  still shows that the edge is there.
- **Coarsen everything uniformly** — raise the tolerance of the whole query until the mesh fits:
  one look for every edge, but once a query passes the budget every visible edge strays beyond
  0.5 px, not only those past it, and the query flattens its edges again for each try.
- **No budget, the rectangle alone** — the rectangle bounds what an edge costs zoomed in, but not
  what a query costs: 1,000,000 edges through one viewport still grow the mesh until memory runs
  out.
- **A depth of 12, 2^12 segments of an edge** — it bounds what one edge costs, about 8,200
  vertices, without the rectangle, but an edge from (0, 0) to (-1e7, 3e6) then strays 2.5 px in a
  viewport on its curve, and one ten times as long 25 px, while the query reports it complete.
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
  beyond the viewport, as far as G-7 allows.
- Negative / trade-offs: at the budget, the mesh takes up to 151 MB in the engine, 24 bytes of
  attributes and up to 12 bytes of indices per vertex, and the engine's scratch of flattened points
  up to about 100 MB more while it grows, kept for the graph's lifetime; the shell's arrays and the
  GPU's buffers take about as much again as the mesh. Such a frame does not hold Q-1; the budget
  bounds memory, and with the flattening stopped at the room left, the work of a query, but not
  to a frame's time.
- Negative / trade-offs: an edge drawn as its chord for the budget strays beyond 0.5 px and draws
  no arrowhead. Q-4 allows that in a coarsened mesh, which inspection reports.
- Negative / trade-offs: the query's origin (ADR-0010) bounds the rounding of vertices near the
  rectangle, not of every vertex the mesh holds. An end at a distance `d` from the origin strays by
  up to `d` × 2^-24 world units, which at a scale `s` reaches 0.5 px from `d` = 2^23 / `s`, about
  2.1e6 at a scale of 4. The split keeps the ends of a segment that meets the rectangle near it; a
  chord of a part whose control points miss the grown rectangle, a segment that passes outside it,
  and the chord of an edge coarsened for the budget are not split, and keep the rounding of their
  ends however far they lie, which Q-4 allows past 2^21 px from the viewport. The first two reach
  into the rectangle only where that rounding exceeds their clearance, at least half the stroke's
  width, which takes ends some 2^23 stroke widths from the query's origin; a bend's offset of up to
  the full width narrows that clearance, and Q-4 bounds the rest at 2^21 px.
- Negative / trade-offs: a chord is shorter than the part it stands for, so where an edge leaves
  the rectangle and comes back, its dash pattern inside may shift when a query moves the chord.
- Negative / trade-offs: which edges keep full detail past the budget follows slot order, not
  what the user looks at.
- Follow-ups: the model of node content; whether the host application learns that a mesh was
  coarsened, which would change the public interface; ordering the edges past the budget by their
  nearness to the viewport's centre.

## Enforcement

Each test and check below cites this ADR with `Verifies: ADR-0012`.

- **Culling:** a Playwright test in `examples/metric-tree/e2e/culling.spec.ts` loads a known
  graph, pans so that a known set of nodes, edges, and labels lies outside the viewport, and
  asserts that none of them is bound to a display object and that the number of display objects
  stays below a bound independent of the graph's size; it repeats this at each level of detail,
  and also `Verifies: G-7`.
- **Drawing:** `scripts/check-structure.sh` fails when a file in `packages/comb/src/render/`
  creates a `Text` or a `Graphics` per edge; its self-test cites this ADR.
- **The budget:** a property test of the engine, `crates/engine/src/graph/budget.rs`, generates
  graphs of long edges and of many edges between few nodes, and queries them at random rectangles,
  scales, and levels, with the budget lowered for the test. It asserts that the mesh holds at most
  the budget's vertices and three times as many indices, that every edge found is drawn, that a
  query reports complete exactly when every edge it found is meshed in full, that a complete query
  draws each edge within a quarter pixel inside its rectangle, an edge from (0, 0) to (-1e8, 3e7)
  among them, and that no segment of an edge's flattening that meets the rectangle has an end
  beyond the grown rectangle. Removing the budget turns it red, and a depth of 12 turns it red on
  the long edges. It also `Verifies: Q-7, Q-4`. A test in `crates/engine-wasm/src/lib.rs` asserts
  that four vertices for each of the most edges a load may hold fit the engine's budget.
- **No trap:** a Playwright test in `examples/metric-tree/e2e/mesh-budget.spec.ts` loads the graph
  of two nodes at (0, 0) and (-1e7, 3e6) with 20,000 edges between them, sets the viewport to a
  scale of 4, and asserts that no page error occurs, that the frame is drawn, that inspection
  reports the mesh complete, and that a valid graph loaded afterwards draws; removing the rectangle
  turns it red, the mesh then reported coarsened. It also `Verifies: Q-7`.
- **The split:** tests in `crates/engine/src/stroke.rs` assert that a straight edge from
  (-1e7, -3e6) to (1e7, 3e6) queried at a scale of 4 around its middle is split on the grown
  rectangle, keeps its distance along the path continuous across the split, counts the split
  points against the room left, and is drawn within a quarter pixel there, as is one from
  (-1e9, -3e8) to (1e9, 3e8), whose ends `f32` rounds by more, and that a path wholly inside the
  rectangle is meshed as without one; without the split, those of the split turn red. A Playwright
  test in `examples/metric-tree/e2e/far-from-the-origin.spec.ts` draws a long edge whose middle,
  where it turns from one bend into the other, flattens into one segment some 4e7 long across a
  viewport at a scale of 4 (graph data describes no straight slanted edge, since edges leave and
  enter their nodes level), and asserts that inspection reports the mesh complete and every point
  of the edge inside the viewport lies within a quarter pixel of half the stroke's width from
  either side of the stroke the shell draws; without the split it turns red. Those of accuracy
  also `Verifies: Q-4`.
- Further tests cite it for what the decision fixes: the layers of the scene
  (`examples/metric-tree/e2e/example.spec.ts`), the scene's numbers
  (`packages/comb/src/render/scene-numbers.test.ts`), the levels' thresholds
  (`examples/metric-tree/e2e/levels-of-detail.spec.ts`), the edges' colours, dashes, and arrowheads
  (`examples/metric-tree/e2e/edge-styles.spec.ts`), the work a pan or drag does per frame
  (`examples/metric-tree/e2e/work-per-frame.spec.ts`), and the other tests of
  `crates/engine/src/stroke.rs` and `crates/engine-wasm/src/lib.rs`.

**Not mechanically decidable:** the branches where `try_reserve` fails; provoking them needs an
allocator that fails on demand, which the engine's tests do not have, so review holds that they
draw chords and never trap.
