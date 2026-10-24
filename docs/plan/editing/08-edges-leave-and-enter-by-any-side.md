# Ticket: Edges leave and enter by any side

## What to build

`EdgeData` gains `sourceSide` and `targetSide`, each `top`, `right`, `bottom`, or `left`, filled
in as `right` and `left` where the host leaves them out. The engine keeps them with each edge and
draws the path between those connectors, its control points pulled along each side's outward
normal (ADR-0024); for right to left that is today's path to the bit. `load`, `addEdge`, and
`updateEdge` take the sides; the bridge refuses another value as `invalidField`.

## Acceptance criteria

- [ ] Given each of the sixteen pairs of sides, when the engine computes an edge's path, then it
      starts and ends at the two connectors and leaves and enters along each side's normal.
- [ ] Given a graph that names no side, when it is drawn, then every existing geometry test and
      the reference image of the edges pass unchanged.
- [ ] Given the budget's property test with random sides, when it runs, then its assertions of
      ADR-0012 hold (Q-4).
- [ ] Given an edge with a side of `"middle"` or a number, when the host loads or adds it, then a
      `GraphDataError` of kind `invalidField` names the field (Q-7); the bridge's property test
      generates both fields.
- [ ] Given an edge, when the host updates its `targetSide`, then the next frame draws it entering
      by that side, and `edgeUpdated` was delivered.
- [ ] Broken once: with the target's control point pulled along the source's normal, the sixteen
      pairs fail.

## Read first

- ADR-0024, ADR-0012 (*The rectangle*, *Sixteen split points*, *Mesh budget*), ADR-0010.
- Glossary: connector, side, edge, arrowhead.
- Convention: *Geometry is tested on its awkward cases*.
- `crates/engine/src/geometry.rs` (`EdgePath::horizontal`, `between`),
  `crates/engine/src/graph/budget.rs`, `e2e/edge-styles.spec.ts`.

## Blocked by

- docs/plan/editing/05-the-host-adds-and-changes-edges.md

## Mode

with the human: it touches `crates/engine-wasm/`, `crates/engine/src/graph/`, and `EdgeData` of
the public interface, protected parts of ADR-0007.
