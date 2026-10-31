# Ticket: A Comb before its first load keeps its engine

## What to build

An engine that has never loaded a graph traps on `query` and on `hit`, and the engine is lost for
the page (ADR-0021), for every Comb on it. `Engine::new` is `Engine::default`
(`crates/engine-wasm/src/lib.rs:427`), whose `Graph` derives `Default`
(`crates/engine/src/graph.rs:134`) with grids of no columns and no rows
(`crates/engine/src/spatial.rs:38`); `Grid::index` caps a cell by `count - 1`
(`crates/engine/src/spatial.rs:118`), which wraps at a count of 0, and the lookup then panics. A
load, an empty one included, and an `addNode` build the grids, so only an engine before both
traps. The shell reaches it from any frame or pointer move before the host's first load: a
`setViewport`, a `fitView`, or a resize schedules a render (`packages/comb/src/api/index.ts:308`)
that queries the engine (`packages/comb/src/render/scene.ts:184`), and a hover asks `hit`
(`packages/comb/src/interaction/gesture.ts:59`). In Chromium, a second Comb made with
`window.createComb` and given `setViewport` before its load tells `onEngineLost` at its first
frame; in Bun, `bridge.hit` and `bridge.query` on a bridge made by `createBridgeSync` with no load
throw `EngineLostError`. Q-7 and ADR-0034 (*Errors*: no export panics) are offended.

An engine that holds no graph answers a query and a hit as one that loaded an empty graph does:
nothing found, a complete mesh, and no trap.

## Acceptance criteria

- [ ] Given `Graph::default()` in `crates/engine`, when it is queried and hit at every level,
      then it finds nothing and does not panic, in a test of the core.
- [ ] Given a Comb made in the example's page before any load, when its viewport is set, the
      view fitted, and the pointer moved over its canvas, then `onEngineLost` is not called, no
      page error is raised, and a later `load` draws, in a browser test.
- [ ] Broken once: with the grid's cap at `count - 1` restored for a grid of no cells, the core
      test fails.

## Read first

- ADR-0021, ADR-0022 (the spatial index), ADR-0034 (*Errors*), Q-7;
  `crates/engine/src/spatial.rs` (`Grid`, `index`), `crates/engine/src/graph.rs` (`Graph`);
  `examples/metric-tree/e2e/engine-lost.spec.ts` as the golden path of a second Comb.

## Blocked by

- None (can start immediately)

## Mode

with the human: the fix may land in `crates/engine/src/graph.rs`, a protected part of ADR-0007,
and the browser test runs through `crates/engine-wasm/`.
