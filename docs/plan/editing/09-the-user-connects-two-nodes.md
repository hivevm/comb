# Ticket: The user connects two nodes

## What to build

G-3. Hovering a node draws its four connectors in a `connectors` layer above the labels; the hit
test of ADR-0025 gains connectors, 8 screen pixels around each, at the near and middle level. A
press on a connector begins a connection: a line in the overlay from that connector to the
pointer, and the connectors of the node under the pointer, the compatible ones drawn apart.
Released over a compatible connector of another node, one the source does not already reach,
Comb calls `CombOptions.canConnect({ source, sourceSide, target, targetSide })`; where it returns
a string, Comb checks it as the identifier of an edge `addEdge` receives, adds the edge between
those sides under it, and delivers `edgeAdded` with `by: "user"`. Released anywhere else, over the
source itself, or refused, it creates none: `false` or any other value that is no string refuses
silently, and a string refused as an identifier (too long, a lone surrogate, one the graph holds)
refuses the connection and its `GraphDataError` is thrown from the input event once the gesture
ended (ADR-0023). Without `canConnect`, no connection begins.

## Acceptance criteria

- [ ] Given two nodes, when the user drags from the bottom connector of one and releases over the
      top connector of the other, then an edge from bottom to top is drawn and `edgeAdded` with
      `by: "user"` and those sides was delivered (G-3).
- [ ] Given a connection, when it is released over the empty canvas, over a connector of the
      source node, or over a node the source already reaches by any sides, then no edge is created
      and no change delivered.
- [ ] Given `canConnect` returning `false`, `undefined`, or a number, or throwing, when the user
      releases over a compatible connector, then no edge is created and no change delivered; a
      thrown error reaches the page after the gesture; returning `"e7"`, the edge `e7` is
      created.
- [ ] Given `canConnect` returning an identifier the graph holds, or one past the length limit,
      when the user releases over a compatible connector, then no edge is created, and a
      `GraphDataError` of kind `duplicateEdge` or `idTooLong` reaches the page after the gesture.
- [ ] Given no `canConnect`, when the user presses on a connector, then no connection begins.
- [ ] Given the far level, when the user presses where a connector would be, then no connection
      begins and no connector is drawn.
- [ ] Given random graphs and points, when the engine hits, then a connector comes before a node,
      as a brute-force scan finds.
- [ ] Broken once: with the duplicate rule removed, the second criterion fails.

## Read first

- ADR-0024, ADR-0025, ADR-0023 (*Vetoes*, *The user's edge*), ADR-0026, ADR-0012 (*Layers*).
- Glossary: connector, connection, side, veto.
- `interaction/index.ts`, `render/scene.ts`, `render/bindings.ts`, `e2e/drag.spec.ts`.

## Blocked by

- docs/plan/editing/06-the-user-selects-an-edge.md
- docs/plan/editing/08-edges-leave-and-enter-by-any-side.md

## Mode

with the human: it touches `crates/engine/src/graph.rs`, `crates/engine-wasm/`, and adds an
option to `CombOptions`, protected parts of ADR-0007.
