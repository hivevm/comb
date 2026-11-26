# `REN-moving-layer-moves-content` assumes uploads that PixiJS 8.23 no longer makes

- **Observed:** REN-moving-layer-moves-content rests on "WebGL uploads at the draw by the range
  marked last". PixiJS 8.23 no longer works so: once a buffer has its GL buffer, `GlBufferSystem`
  uploads it at every `update` event. `MeshBuffers` still keeps `wholeMarked` for the old model, and
  the count of the mesh's uploads in `comb/testing` follows it. The review of ticket 03 of
  revision-2026-11-18 found it on 2026-11-25.
- **Where:** `docs/adr/REN-moving-layer-moves-content.md` and `MeshBuffers` in
  `packages/comb/src/render/edges.ts`.
