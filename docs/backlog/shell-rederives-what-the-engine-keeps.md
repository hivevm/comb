# The shell re-derives relative positions the engine keeps

- **Observed:** the design revision of 2026-11-20 found this without evidence
  (NUC-design-is-revised §3). The human had it recorded on 2026-11-21.
  - The engine keeps each node's position relative to its container.
  - The shell still scans in TypeScript for relative positions and for which nodes a gesture
    moved: `heldBy` of the resize, `regionChanges`, `placeOf`, and the take-back of a refused move.
  - The store carries bookkeeping of the region tree (`regionViewsOf`, `withRegions`) beside the
    engine's slots.
- **Where:** `packages/comb/src/interaction/resize.ts`,
  `packages/comb/src/interaction/region-line.ts`, `packages/comb/src/api/changes.ts`,
  `packages/comb/src/store/index.ts`.
