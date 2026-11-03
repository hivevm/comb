# Ticket: A hidden edge mesh keeps what it did not upload

## What to build

`EdgesContainer.sync` of `packages/comb/src/render/edges.ts` hides the mesh with
`visible = false` when the query found no edge. PixiJS 8.22.0 still calls the mesh's `onRender`
hook then (`RenderGroup.runOnRender`, `RenderGroupSystem.mjs`), and that hook clears the
mesh's mark. But a mesh PixiJS does not draw binds no geometry, so nothing uploads.

The steps that draw ghosts, on WebGL:

1. A query finds N edges.
2. A pan into empty space queries none. `set` zeroes indices `[0, N)` and marks N, but the mesh
   is invisible, so nothing uploads and the mark is cleared.
3. A query finds M < N edges and marks M.
4. `GlBufferSystem.updateBuffer` uploads only that range, so the GPU still holds step 1's indices
   in `[M, N)`.
5. The mesh draws the whole index buffer's length (`GlGeometrySystem.mjs`), so step 1's edges
   draw again against stale vertices.

`main` before ticket 01 had the same defect.

The mesh keeps its mark until a draw that uploads it: the hook clears it only when the mesh was
drawn, or the mesh tracks what the GPU holds. A browser test drives the sequence above and
asserts that no edge of step 1 is drawn after step 3, by the bytes the index buffer uploads or by
the pixels.

## Acceptance criteria

- [ ] Given a query of N edges, then one of none, then one of M < N, when the third renders,
      then the index buffer's upload covers `[0, N)`, and no pixel of an edge only the first
      query found is drawn.
- [ ] Given the browser tests of `examples/metric-tree/e2e/work-per-frame.spec.ts`, when they
      run, then they pass unchanged.

## Read first

- ADR-0012, ADR-0027.
- `packages/comb/src/render/edges.ts` (`EdgesContainer`, `MeshBuffers`), and PixiJS 8.22.0
  `RenderGroupSystem.mjs` and `GlBufferSystem.mjs` in `node_modules/pixi.js`.

## Blocked by

- None (can start immediately)

## Mode

unattended: it touches no protected part of ADR-0007, and a test decides it. Stop after two
attempts at a test that cannot reproduce the ghost; leave what was found here and hand off.
