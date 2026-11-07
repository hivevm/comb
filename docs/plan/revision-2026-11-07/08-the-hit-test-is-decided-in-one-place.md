# Ticket: The hit test is decided in one place, and a small circle has no dead zone

## What to build

What a press hits is decided across three accepted ADRs. ADR-0013, the node content model,
holds the order of the hit test and the connector's reach, revised by ticket 07 of the state
diagram (b54821d) so that inside its node a connector reaches at most a quarter of the node's
extent; its text still cites the superseded ADR-0025 for the connectors. ADR-0031 decides the
connectors themselves, and ADR-0032 that a node is hit within its outline and a press inside its
bounding rectangle but outside its outline hits what lies below. Ticket 07 had to revise the
content model's ADR to change a rule about connectors, and had to read "bounds" in ADR-0013
against ADR-0032's bounding rectangle to decide which one clips the reach.

The review of ticket 07 (merge 25eb7f9) named the consequence of that reading: in a circle, an
ellipse, or a diamond under 32 screen pixels, a press inside the rectangle but outside the outline
within 8 pixels of a connector now hits neither the connector, whose reach the rectangle clipped,
nor the node, which is hit within its outline. No test fixes the rectangle's edge, which counts as
inside.

For the maintainer to decide:

1. Whether the hit test's decisions, the order, the connector's reach and its clip, the outline,
   and what lies below, have grown into one that a superseding ADR states, superseding the parts
   of ADR-0013, ADR-0031, and ADR-0032 that hold them. An ADR supersedes whole ADRs between
   normalizations ([`docs/adr/README.md`](../../adr/README.md#mechanics)), so the alternative is
   to leave the three as they stand and restate the hit test as one ADR at the next normalization.
2. Whether the dead zone is meant. If not, "within the node's bounds" reads as within its outline
   for the clip, a one-line change of `connector_at` in `crates/engine/src/graph/hit.rs` and of
   `Model::connector_at` in `crates/engine/src/graph/tests.rs`, decided by a test of a small
   circle's corner.

## Acceptance criteria

- [ ] Given the maintainer's decision on 1, when it is taken, then either a consolidating ADR is
      proposed through `propose-adr`, or this ticket records that the hit test waits for the next
      normalization.
- [ ] Given the maintainer's decision on 2, when it is taken, then a test of
      `crates/engine/src/graph/hit.rs` presses a circle under 32 screen pixels inside its
      rectangle, outside its outline, within 8 pixels of a connector, and asserts what the
      decision says it hits.

## Read first

- Touches: `docs/adr/`, `crates/engine/src/graph/hit.rs`, `crates/engine/src/graph/tests.rs`
- ADR-0013 *Hit test*, ADR-0031 *Decision*, ADR-0032 *Hit test*.
- The merge message of 25eb7f9, *Doubts* and *Review*.

## Blocked by

- None (can start immediately)

## Mode

with the human: it decides whether to supersede accepted ADRs, which only the maintainer may, and
`crates/engine/src/graph/` is a protected part of ADR-0007.
