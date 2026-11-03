# Ticket: The moving layer in a module of its own, and the mesh that knows what it marked

## What to build

The moving layer of ADR-0027 is one concept spread over `packages/comb/src/render/scene.ts`,
`packages/comb/src/render/edits.ts`, `packages/comb/src/render/edges.ts`,
`packages/comb/src/render/edges-canvas.ts`, and `packages/comb/src/render/particles.ts`. `Scene`
holds nine fields of it (`hidden`, `edits`, `editedFrom`, `movingEdgeSlots`, `movingFor`,
`draggedAt`, `queried`, `current`, `movingDetail`) beside the query's, and five methods
(`readEdits`, `moving`, `hideNew`, `dropped`, `edgeDrawn`), so the file has grown to 511 lines and
owns two states.

What WebGL uploads also leaks into `Scene`. A buffer's last marked range wins, so `Scene` tracks
`queried` and passes it as the `whole` flag of `MeshBuffers.hide(ranges, whole)`. Because
`EdgeFill.hide` takes no such flag, `Scene` branches on `instanceof EdgesContainer`.

The moving layer's state and its decisions move into one module beside the scene, which the
scene asks each render. The edge mesh remembers that its last `set` marked the whole buffer, and
its `hide` keeps that mark. The scene then passes no flag and tells the WebGL edges from the
Canvas 2D edges by no type test. Behaviour does not change.

## Acceptance criteria

- [ ] Given `packages/comb/src/render/scene.ts`, when it is read, then it holds no field of the
      moving layer's state; one module of `packages/comb/src/render/` holds them and the decisions
      of ADR-0027 that read them.
- [ ] Given `packages/comb/src/render/edges.ts`, when `hide` is called after a `set` in the same
      render, then the whole index buffer is marked for upload with no argument saying so, and
      the existing test of the bytes a zoom during a drag uploads passes unchanged.
- [ ] Given the scene, when it hides edges, then it calls one `hide` of a type both edge layers
      implement, with no `instanceof`.
- [ ] Given the Bun tests of `packages/comb/src/render/` and the browser tests
      `examples/metric-tree/e2e/work-per-frame.spec.ts`, `examples/metric-tree/e2e/drag.spec.ts`,
      and `examples/metric-tree/e2e/remove.spec.ts`, when they run, then they pass unchanged.

## Read first

- ADR-0012, ADR-0027.
- `packages/comb/src/render/scene.ts`, `packages/comb/src/render/edges.ts` (`MeshBuffers`,
  `hiddenRanges`), `packages/comb/src/render/edges-canvas.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended: it touches no protected part of ADR-0007, its criteria are decided by tests that
exist, and behaviour does not change. Stop after two attempts at a criterion that stays red, or
where the module boundary needs a decision ADR-0027 does not make; leave the state here and hand
off.
