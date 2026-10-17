# Spec: Large graphs

## Problem

A developer who loads a graph of tens of thousands of nodes into Comb gets a canvas that creates a
display object for every node and redraws every edge and edge label on every frame. Zoomed out,
the whole graph is drawn at full detail. Nothing measures how fast that is, so nobody can tell
whether Comb meets the reason it exists.

## Solution

The developer loads 50,000 nodes and 50,000 edges, and dragging, panning, and zooming stay at
60 frames per second on the reference machine. The canvas draws only what lies in the viewport,
draws all edges of a layer at once, and draws less detail the further the user zooms out. A
benchmark says, for every change, how fast loading, dragging, panning, and zooming are, and a
check holds the bundle under its budget. The example's control multiplies the metric tree up to
50,000 nodes, so anyone can see it.

## Existing behaviour

- The engine computes edge paths, edge-label placement, and moves on the positions buffer; the
  shell reads positions through a fresh view per read. Its Rust and Bun tests pin this, the
  bridge's against the built WebAssembly module, and they stay green.
- The scene has the layers of ADR-0012 but no pooling, culling, edge mesh, or levels of detail:
  every node has a display object, all edges share one `Graphics` redrawn on every change, and
  edge labels are rebuilt on every render.
- Dragging a node moves its edges and edge labels with it; selecting a node shows it in the
  sidebar, and a title edited there shows on the canvas. Only the example's browser test pins
  the example as a whole; the first ticket that changes the scene adds a browser test that pins
  drag and selection before it changes them.
- The example offers 1, 10, or 100 copies of the metric tree.

## Goals served

- Q-1 — 60 fps p95 with 50,000 nodes and 50,000 edges while dragging, panning, and zooming.
- Q-2 — a graph of that size opens within 1 s.
- G-7 — nothing entirely outside the viewport is drawn.
- Q-3 — the bundle stays under 300 kB.
- G-9 — the example's control multiplies the tree up to 50,000 nodes.

## User stories

1. As a developer embedding Comb, I want a graph of 50,000 nodes to stay fluid while I drag,
   pan, and zoom, so that my users can work on graphs that size.
2. As a developer, I want such a graph to open within a second, so that my application does not
   stall when it loads one.
3. As a user zoomed far out, I want to see the shape of the whole graph, so that I can find my way
   to the part I want, even though titles and values are not legible at that scale.
4. As a user zoomed in, I want every node to show its title and every edge its label, so that I
   can read what I edit.
5. As a maintainer, I want a benchmark that reports load time and frame times at a known graph
   size, so that I can tell whether a change made Comb faster or slower.
6. As a maintainer, I want CI to fail when the bundle reaches its budget or a benchmark regresses,
   so that performance does not erode one change at a time.
7. As someone trying Comb, I want the example to scale the tree up to 50,000 nodes, so that I can
   see the performance for myself.

## Implementation decisions

- **Spatial index in the engine.** The engine keeps a uniform grid over node bounds, rebuilt on
  load and updated by moves; a query returns the slots whose bounds meet a rectangle. Edges are
  found through the nodes at their ends, so an edge is visible when its path's bounding box meets
  the viewport. The query result crosses as a `Uint32Array` view on an engine-owned buffer
  (ADR-0010).
- **Pooling and culling in the scene.** After a change of the viewport or of positions, the scene
  asks the engine for the visible slots, with a margin, binds pooled node views and edge-label
  views to exactly those, and returns the rest to their pools (ADR-0012).
- **Edge mesh.** The engine computes the path points of the visible edges into an engine-owned
  buffer; the edges layer draws them as one mesh, with each edge's colour, dash pattern, and
  arrowhead from the graph data.
- **Levels of detail.** Near: node box, title, edge labels. Middle: node box and title only. Far:
  nodes as particles of one particle container, edges as thin lines, no text. The zoom
  thresholds are numbers in the code that the benchmark sets.
- **Benchmark.** A Playwright run against the example at a fixed size of 50,000 nodes and 50,000
  edges, measuring time to first frame after load and p95 frame time while a node is dragged,
  the viewport panned, and zoomed. It writes its numbers as JSON. On the reference machine the
  maintainer runs it and compares with Q-1 and Q-2; in CI a scheduled and on-demand workflow
  compares with a recorded baseline and fails beyond a set regression.
- **Bundle check.** A check that builds the library bundle, gzips its JavaScript and WebAssembly
  without PixiJS, and fails at 300 kB.
- **Example.** The copies control reaches 50,000 nodes, and a query parameter sets the copies so
  the benchmark opens the size directly.

## Testing decisions

- Engine: Rust unit tests for the grid index (insert, move, query against a brute-force scan on
  random graphs) beside the existing geometry tests.
- Bridge: Bun tests that query the index through the bridge and read the result view after the
  engine's memory grew, as the existing bridge tests do.
- Scene: Playwright tests in the example that read a test-only count of bound display objects
  after panning a known graph: none outside the viewport (G-7), and a count bounded independently
  of the graph's size, at each level of detail.
- Structural tests of ADR-0009 and ADR-0012 as checks under `scripts/`.
- Benchmark and bundle check as described above; neither runs in the pre-push gate except the
  bundle check, which is fast.

## Out of scope

- Connecting, deleting, and dragging edge labels (G-3, G-4, G-6), the node content of ADR-0013,
  and edge appearance beyond what the mesh needs (G-11): the next spec, *Editing*.
- Moving the engine into a worker.
- Absolute performance numbers in CI; CI only compares with its own baseline.

## ADR impact

Binding: ADR-0008 (benchmark, bundle check, `check-code.sh`), ADR-0009 (layers and their
direction, structural test), ADR-0010 (index results and path points as typed-array views),
ADR-0011 (coordinates stay out of the store), ADR-0012 (this spec implements it), ADR-0017 (any
new action pinned by SHA). No new ADR: every decision above implements one in force. Where the
benchmark contradicts ADR-0012, for instance the edge mesh against a measured alternative, that
is a revision of ADR-0012 in a pull request of its own.
