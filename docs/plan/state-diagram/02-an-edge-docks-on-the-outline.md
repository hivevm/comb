# Ticket: An edge docks on the node's outline, any number of them on one node

## What to build

The host application lets an end of an edge dock on the outline. The end then lies where the
line towards the edge's other end crosses the node's outline, and the arrowhead's tip lies
there. Any number of edges dock on one node from any direction, and follow it as it moves. The
state diagram's transitions dock on the outline. An end that names a side keeps today's
connector.

## Acceptance criteria

- [ ] Given two nodes of each node shape and an edge docked on the outline at both ends, when the
  canvas draws it, then each end lies on its node's outline on the line between the two centres,
  within the accuracy of Q-4 (G-13).
- [ ] Given five edges docked on one node from five directions, when the node is dragged, then
  every end follows on the outline, and no two ends coincide (G-13, G-2).
- [ ] Given an edge with an end naming a side, when the canvas draws it, then it starts at that
  side's connector as before (ADR-0025's successor).
- [ ] Given the state diagram, when it is drawn, then its transitions dock on the outline
  (G-12).

## Read first

- Touches: `crates/engine/`, `crates/engine-wasm/`, `packages/comb/src/`, `examples/uml/`,
  `docs/ARCHITECTURE.md`
- The spec, and the proposed ADR on docking on the outline (superseding ADR-0025).
- Glossary: *Connector*, *Side*, *Edge mesh*, *Arrowhead*.
- Golden path: the edge path of ADR-0025 and its geometry tests.

## Blocked by

- docs/plan/state-diagram/01-a-node-is-drawn-in-its-node shape.md

## Mode

with the human: it touches protected parts (the bridge, the data format) and supersedes
ADR-0025.
