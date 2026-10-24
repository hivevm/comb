# Ticket: A dragged node reports where it landed

## What to build

The user drags a node as today; when the pointer is released, `onChange` delivers one
`{ kind: "nodeMoved", by: "user", id, x, y }` with the node's position as the engine keeps it. A
press that moves nothing delivers none, and no change is delivered per frame of the drag.

## Acceptance criteria

- [ ] Given a listener of `onChange`, when the user drags a node across several frames and
      releases it, then the listener received exactly one `nodeMoved` with the node's identifier
      and its position as inspection reports it.
- [ ] Given a node, when the user presses and releases on it without moving, then no change is
      delivered.
- [ ] Given a drag, when the pointer is released outside the canvas, then `nodeMoved` is delivered
      as on the canvas.
- [ ] Broken once: with the change delivered on every pointer move, the first criterion fails.

## Read first

- ADR-0023 (*Delivery*), ADR-0011 (*Coordinates*).
- `interaction/index.ts` (the drag), the example's `e2e/drag.spec.ts`, the golden path.

## Blocked by

- docs/plan/editing/01-the-host-adds-a-node.md

## Mode

with the human: the change it delivers is part of the public interface of ADR-0023, which the
maintainer reviews under ADR-0007, though the code is in `packages/comb/src/interaction/` and the
store.
