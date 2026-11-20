# A composite state's orthogonal regions are added and named only in the seed

- **Observed:** the UML example's state diagram divides a composite state into orthogonal regions
  in its seed alone. The user cannot add a region to a composite state, remove one, or name one,
  as the activity diagram's partitions are added and renamed since ticket 16 of uml-diagrams. The
  whole-branch review of uml-diagrams found it on 2026-11-20, and the human counted G-20 as met
  with it open.
- **Where:** `examples/uml/src/state-diagram.ts`, the palette's drop and the frame's partitions of
  `examples/uml/src/main.ts` and `examples/uml/src/sidebar.ts`, and `updateNode` with `regions`.
