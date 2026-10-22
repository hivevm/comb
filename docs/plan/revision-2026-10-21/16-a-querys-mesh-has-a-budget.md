# Ticket: A query's mesh has a budget

## What to build

A graph that the bridge accepts can run the engine out of memory at its first render. Each edge is
flattened into up to 2^12 segments (`MAX_DEPTH` in `crates/engine/src/stroke.rs`), and a query
meshes every edge it finds, whole (`Graph::query` in `crates/engine/src/graph.rs`), into vectors
that grow without bound. Two nodes, `a` at (0, 0) and `b` at (-1e7, 3e6), with 20,000 edges from `a`
to `b`, load and draw without a refusal. A `setViewport({ x: 0, y: 0, scale: 4 })` then makes the
next frame throw `unreachable` from WebAssembly, inside the animation frame, where the host
application cannot catch it. From then on every call into the engine fails untyped with `recursive
use of an object detected`. Called directly, 10,000 such edges at a pixel of 0.25 world units trap
at 3.7 GB, and 2,000 already take 921 MB and 2.3 s. The data stays far below the limits of a load
(1,000,000 edges) and below Q-2's 50,000.

The decision is recorded in ADR-0012 (*The rectangle*, *Mesh budget*) and ADR-0010 (*Streams*),
both revised and proposed. The tests cite the drafted Q-7's sentence on accepted graph data and
the drafted Q-4 in docs/plan/revision-2026-10-21/08-q7-spec-change.md (`Verifies: Q-7`,
`Verifies: Q-4`), and ADR-0012.

## Acceptance criteria

- [ ] Given the graph above, when the host loads it and sets the viewport to scale 4, then no
      page error occurs, the frame is drawn, `inspect()` reports the mesh complete, and a valid
      graph loaded afterwards draws (`Verifies: Q-7, ADR-0012`).
- [ ] Given any graph within the limits of a load, when any viewport is queried, then the mesh
      holds at most the budget's vertices and three times as many indices, every edge found is
      drawn, and the query returns without a trap; a query whose full mesh fits reports it
      complete and draws each edge within a quarter pixel inside its rectangle. A property test of
      the engine generates long edges and many edges between few nodes, with the budget lowered
      for the test, and asserts it (`Verifies: Q-7, Q-4, ADR-0012`).
- [ ] Given a small graph, and a graph of 1,000,000 curved edges queried whole at the far level,
      when each is queried through the bridge, then the first reports its mesh complete and the
      second coarsened (`Verifies: ADR-0010`); and four vertices for each of the most edges a
      load may hold fit the engine's budget (`Verifies: ADR-0012`).
- [ ] Given the benchmark's graph, when its first frame and gestures are measured, then Q-1 and
      Q-2 hold as before, and edge paths stay within Q-4's 0.5 px wherever the budget is not
      reached.
- [ ] Broken once: without the rectangle, the first criterion's browser test fails with the trap;
      without the budget, the second criterion's property test fails.

## Read first

- `docs/SPECIFICATION.md` Q-1, Q-2, Q-4, Q-7, and the drafted Q-7 and Q-4 in
  docs/plan/revision-2026-10-21/08-q7-spec-change.md; ADR-0012 (*The rectangle*, *Mesh budget*),
  ADR-0010 (*Streams*), ADR-0009 (*Core*, *Bridge*), ADR-0007 (protected parts).
- `crates/engine/src/stroke.rs` (`MAX_DEPTH`, the flattening), `crates/engine/src/graph.rs`
  (`query`, `out.mesh.add_edge`), `packages/comb/src/render/edges.ts` (the mesh's buffers).
- `examples/metric-tree/e2e/malformed.spec.ts`, the golden path of the browser test.

## Blocked by

- The maintainer's review of the revisions of ADR-0012 and ADR-0010, in a pull request of ADRs
  only, and the maintainer's decision on the drafted changes of Q-7 and Q-4 that ADR-0012 rests
  on (docs/plan/revision-2026-10-21/08-q7-spec-change.md).

## Mode

with the human: the query's detail changes the data format of the bridge, a protected part of
ADR-0007, and the drafted Q-7 and Q-4 that the tests cite land only by the maintainer.
