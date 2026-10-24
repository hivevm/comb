# Ticket: The pointer of a connection stays out of the store

## What to build

ADR-0011, accepted, keeps every coordinate out of the store and rejects coordinates in it for the
store update per frame they cost (Q-1). The store's `Connection` holds `to`, the world point the
user drags the connection to (`packages/comb/src/store/index.ts`), and interaction writes it on
every pointer move (`interaction/index.ts`, `connect(connectionAt(...))`), so a connection drag
sets the store once per frame. ADR-0011 also does not list the node under the pointer
(`hovered`) or the connection among what the store holds.

Keep the dragged point out of the store, as a drag keeps a node's position: in interaction's state
or a buffer the overlay reads, signalled by the counter the store already has, while the store
keeps the connection's source, side, node under the pointer, and compatibility, which change
rarely. If the maintainer prefers the store to hold transient pointer state, that is a
superseding ADR for ADR-0011, not this ticket.

## Acceptance criteria

- [ ] Given a connection dragged across the empty canvas, when the pointer moves, then no store
      action that writes a coordinate runs, and the overlay's line still follows the pointer
      (`Verifies: ADR-0011`).
- [ ] Given the browser tests of the connection, when they run, then they pass unchanged.
- [ ] Broken once: with the point written into the store again, the first criterion's test fails.

## Read first

- ADR-0011 (*Coordinates*, *Alternatives considered*), ADR-0024 (*Drawing*), ADR-0027.
- `packages/comb/src/store/index.ts` (`Connection`), `interaction/index.ts`,
  `interaction/connect.ts`, `render/connectors.ts`, `render/scene.ts` (the overlay).

## Blocked by

- None (can start immediately)

## Mode

with the human: the maintainer decides between this and superseding ADR-0011, before work starts.
