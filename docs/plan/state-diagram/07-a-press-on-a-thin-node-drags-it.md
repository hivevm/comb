# Ticket: A press on a thin node drags it, not a connection

## What to build

A press hits a connector before the node it belongs to, within `CONNECTOR_REACH` (8 screen
pixels) of it (`Graph::hit_at` in `crates/engine/src/graph/hit.rs`, ADR-0013). A bar is 8 world
units high, 4.8 screen pixels at scale 0.6, so its top and bottom connectors each reach past its
centre. A press anywhere on the bar starts a connection, and the bar cannot be dragged at the
near and middle levels. The same holds for any node less than twice the reach high or wide on
screen. Ticket 05's benchmark ran into it: its first shaped run failed at `drag near` on a bar,
and the drag gesture now skips nodes whose centre does not hit as the node.

Make a press on a node's body drag the node wherever a connector's reach would otherwise cover
it, while each connector stays reachable. Which rule does it is a decision for ADR-0013 (or
ADR-0031), revised with the maintainer before it is implemented. Candidates are:

- a reach clipped at the node's centre line;
- a connector hit only outside the node's bounds;
- a minimum height on screen below which connectors are not offered.

## Acceptance criteria

- [ ] Given a bar at the near and the middle level, when it is pressed at its centre and dragged,
      then the bar moves and no connection starts.
- [ ] Given a bar, when each of its four connectors is pressed, then a connection starts from it.
- [ ] Given a node at least twice the reach in both dimensions on screen, when anything is
      pressed, then the hit is the one it is today.

## Read first

- Touches: `crates/engine/src/graph/hit.rs`, `docs/adr/`, `bench/run.ts`
- ADR-0013 (hit testing), ADR-0031 (connectors and docking), ADR-0032 (the bar).
- The merge of ticket 05, its *Doubts* (the drag's node choice in `bench/run.ts`, which may go
  back to the nearest node once this lands).

## Blocked by

- None (can start immediately)

## Mode

with the human: it revises an ADR, and it touches `crates/engine/src/graph/`, a protected part of
ADR-0007.
