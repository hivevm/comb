# The user cannot connect onto an edge

- **Observed:** an edge may end on another edge at a path parameter, but only the host makes it so,
  through a load or `addEdge`. The connect gesture ends on a node alone, so the user cannot anchor
  a comment or a constraint on an edge by hand. Ticket 10 of uml-diagrams settled this with the
  human on 2026-11-18 and left the gesture to the backlog.
- **Where:** the connect gesture in `packages/comb/src/interaction/connect.ts`, the engine's hit
  test of an edge's path in `crates/engine/src/graph/`, and `canConnect` in
  `packages/comb/src/api/editors.ts`.
