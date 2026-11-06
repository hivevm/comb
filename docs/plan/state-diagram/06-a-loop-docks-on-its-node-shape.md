# Ticket: A loop docks on the outline of its node's node shape

## What to build

A loop leaves and re-enters its node a quarter of the side's length either side of the side's
middle (ADR-0031). The engine takes those points on the node's rectangle, whatever its node shape
(`EdgePath::looped` in `crates/engine/src/geometry.rs`). On an ellipse, a circle, or a diamond
they lie off the drawn outline, up to about 32 world units on a diamond 128 high, so the loop and
its arrowhead float beside the node. A rectangle and a rounded rectangle are not affected, nor is
the state diagram's loop on *ready*.

Make a loop's two ends lie on the outline of its node's node shape, its arrowhead's tip on the
outline, with the loop's shape and its label's place otherwise as ADR-0031 states. How the ends
move onto the outline (along the side's normal, or towards the node's centre) is a decision for
ADR-0031, revised with the maintainer before it is implemented.

## Acceptance criteria

- [ ] Given a loop on each side of a node of each node shape, when its path is computed, then
      both ends lie on the node's outline within the accuracy of Q-4, and the tangent at the end
      points into the node.
- [ ] Given a rectangle or a rounded rectangle, when a loop is computed, then its path is the one
      it is today, to the bit.
- [ ] Given a loop on an ellipse far from the world's origin, when its path is computed, then every
      point is one `f32` holds.

## Read first

- Touches: `crates/engine/src/geometry.rs`, `crates/engine/src/graph/`, `docs/adr/`
- ADR-0031 (*Loops*), ADR-0032 (the outline and `crossing`).
- The test in `crates/engine/src/graph/edges.rs` that pins a loop on an ellipse to the
  rectangle's side; it changes with this ticket.
- The merge of ticket 03 (f2646dd), its *Doubts*.

## Blocked by

- None (can start immediately)

## Mode

with the human: it revises ADR-0031, and it touches `crates/engine/src/graph/`, a protected part
of ADR-0007.
