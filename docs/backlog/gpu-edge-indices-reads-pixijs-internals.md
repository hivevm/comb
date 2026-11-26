# `gpuEdgeIndices` reads a field internal to PixiJS

- **Observed:** `gpuEdgeIndices` of `comb/testing` reads `indexBuffer._gpuData[renderer.uid]`,
  internal to PixiJS. A change of PixiJS's internals broke it once already, at dc803c3b, as
  `_upload` broke the count of the mesh's uploads at 12ffb82f, which ticket 03 of
  revision-2026-11-18 replaced by a count of Comb's own. Its review found it on 2026-11-25.
- **Where:** `gpuEdgeIndices` in `packages/comb/src/testing.ts`.
