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

## Decision

We will create PixiJS display objects only for the nodes, edge labels, and connectors the engine's
spatial index reports inside the viewport, take them from pools and return them there, draw all
edges of a layer as one mesh from the edge geometry the engine computes, and choose by zoom
between three levels of detail.

- **Layers:** a `world` container with `isRenderGroup`, holding in drawing order `grid`, `edges`,
  `nodes`, `labels`, and `connectors`; an `overlay` outside `world` for the drag preview and the
  selection frame, in screen coordinates.
- **Culling:** after every change of the viewport or of coordinates, `render` asks the engine for
  the slots inside the viewport, with a margin, and binds pooled display objects to exactly those.
  PixiJS's own culling stays off.
- **Edges:** the engine computes the path points of every edge into a buffer (ADR-0010); `edges`
  draws them as one mesh per layer, with the dash pattern and arrowheads of G-11 in its geometry
  or shader, not as a `Graphics` per edge.
- **Text:** every text on the canvas is `BitmapText`.
- **Levels of detail:** *near* draws the full node content (G-10) and edge labels; *middle* draws
  each node's box and title without the rest of its content; *far* draws nodes as particles of one
  `ParticleContainer` and no text. The thresholds are numbers in the code, set by the benchmark.

**Out of scope:** the model of node content and how its elements are laid out; the zoom
thresholds; hit testing, which the engine answers from the same spatial index.

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

## Sources / Prior art

- PixiJS v8, *Performance tips* — <https://pixijs.com/8.x/guides/concepts/performance-tips>:
  culling off by default and better at the application level, batching limits, `BitmapText`.
- PixiJS v8, *Particle container* —
  <https://pixijs.com/8.x/guides/components/scene-objects/particle-container>.
- PixiJS v8, *Render groups* — <https://pixijs.com/8.x/guides/concepts/render-groups>.
- npm `pixi.js` 8.22.0, MIT (checked 2026-10-17).

## Consequences

- Positive: the number of display objects follows what is visible at the current level of detail,
  not the size of the graph, which serves Q-1 and Q-2.
- Positive: panning and zooming move one render group on the GPU.
- Negative / trade-offs: pooling means a display object is bound to a different node from frame
  to frame; any state kept on it outside the binding is a bug.
- Negative / trade-offs: a custom edge mesh and its shader are more code than `Graphics`, and
  `BitmapText` renders less crisp text than `Text` at some sizes.
- Follow-ups: the model of node content; the zoom thresholds; the margin around the viewport.

## Enforcement

A Playwright test loads a known graph, pans so that a known set of nodes, edges, and labels lies
outside the viewport, and asserts that none of them is bound to a display object and that the
number of display objects stays below a bound independent of the graph's size; it repeats this at
each level of detail. A check fails when a file in `packages/comb/src/render/` creates a `Text`
or a `Graphics` per edge. Each cites this ADR with `Verifies: ADR-0012`, and the first also
`Verifies: G-7`.
