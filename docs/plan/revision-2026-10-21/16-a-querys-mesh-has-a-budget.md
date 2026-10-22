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

A query builds a mesh of bounded size: a budget of segments or vertices per query, with
`try_reserve` where the mesh's vectors grow, so that running short of memory is an outcome of the
query, not a trap. What the engine does when the visible edges exceed the budget is the decision
this ticket starts with: coarsen the flattening (against Q-4's 0.5 px), clip the flattening to
the query's rectangle (which keeps Q-4 inside it), leave edges out, or return a typed outcome
that the shell draws around. The decision is recorded first, as an ADR, or as a drafted change
of the specification where it gives up some of Q-4, in a pull request of its own. Q-7 covers
malformed data; that a valid graph never crashes the page is a criterion the specification does
not state yet, and that revision says which criterion the tests cite.

## Acceptance criteria

- [ ] Given the graph above, when the host loads it and sets the viewport to scale 4, then no
      page error occurs, the frame is drawn or the shell reports a typed outcome, and a valid
      graph loaded afterwards draws (`Verifies:` the criterion the decision names).
- [ ] Given any graph within the limits of a load, when any viewport is queried, then the mesh
      holds at most the budget's vertices and the query returns without a trap; a property test
      of the engine generates long and many edges and asserts it.
- [ ] Given the benchmark's graph, when its first frame and gestures are measured, then Q-1 and
      Q-2 hold as before, and edge paths stay within Q-4's 0.5 px wherever the budget is not
      reached.
- [ ] Broken once: without the budget, the first criterion's browser test fails with the trap.

## Read first

- `docs/SPECIFICATION.md` Q-1, Q-2, Q-4, Q-7 (malformed data only); ADR-0012 (the scene and its
  levels of detail), ADR-0009 (*Core*), ADR-0010 (the bridge's errors), ADR-0007 (protected parts).
- `crates/engine/src/stroke.rs` (`MAX_DEPTH`, the flattening), `crates/engine/src/graph.rs`
  (`query`, `out.mesh.add_edge`), `packages/comb/src/render/edges.ts` (the mesh's buffers).
- `examples/metric-tree/e2e/malformed.spec.ts`, the golden path of the browser test.

## Blocked by

- None (can start immediately)

## Mode

with the human: what the engine gives up past the budget, accuracy (Q-4), edges, or a frame, is
a decision on the specification's criteria, which only a human lands, and a typed outcome of the
query changes the data format of the bridge, a protected part of ADR-0007.
