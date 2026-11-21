# Browser-test helpers are copied between specs

- **Observed:** the design revision of 2026-11-20 found this without evidence
  (NUC-design-is-revised §3). The human had it recorded on 2026-11-21.
  - The UML example's specs copy helpers: `dataOf` and `dropAtWorld` four times each;
    `connectWorld`, `boxesOf`, and others three times.
  - The metric tree's specs copy a pixel sampler six times, `openOnCanvas` twice, and readers of
    boxes five times.
  - Older than uml-diagrams: `packages/comb/src/api/snapshot.ts` imports `EDGE_ARROW` and
    `edgeColor` from `render/edges`.
- **Where:** `examples/uml/e2e/` (`use-case-diagram.spec.ts`, `notation-diagram.spec.ts`,
  `activity-edit.spec.ts`, `state-edit.spec.ts`, and more), `examples/metric-tree/e2e/`, and
  `packages/comb/src/api/snapshot.ts`.
