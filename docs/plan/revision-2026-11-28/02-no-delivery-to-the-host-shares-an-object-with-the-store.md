# Ticket: No delivery to the host shares an object with the store, for every change kind

## What to build

The convention *Hand the host copies* says that what a change or a method gives the host
application is a copy, never an object the store keeps. It did not prevent the same mistake
twice in the work since 2026-11-18:

- ticket 16 of revision-2026-11-20 (PR #109) made `nodeUpdated` read each field through
  `NODE_PATCH_READS` in `packages/comb/src/api/changes.ts`, which copies it;
- `nodeAdded` still handed its listeners the store's own outline tuple until 5e3625ae (PR #117)
  fixed it. A backlog entry, `node-added-hands-out-the-stores-outline.md`, had recorded it, and the
  fix pinned that one field with a browser test of `examples/metric-tree/e2e/add-node.spec.ts`.

Each fix is pinned field by field. A field a later change adds to a delivery is held by nothing.
A mistake a check would have caught becomes a check
([`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done)).

Let one test of `packages/comb/src/api/` take each kind of `GraphChange` (`loaded`, `nodeAdded`,
`nodeUpdated`, `nodeMoved`, `nodeResized`, `regionsMoved`, `nodesRemoved`, `edgeAdded`,
`edgeUpdated`, `edgesRemoved`, `labelMoved`) as `onChange` delivers it, and the arguments Comb hands
each veto, walk every object and array inside it, and fail where one is the same object (`===`) as
one the store's state reaches. The test reads the kinds from the `GraphChange` type or a table the
type checks, so that a new kind without a case fails.

Whether the entry *Hand the host copies* then stays is the maintainer's call: the proposed
API-export-apply-change cites it.

Not in this ticket, by the human's decision of 2026-11-28: `onChange` hands one delivery object to
every listener, and gives no listener a copy of its own (PR #117's doubts). Nothing in it is
shared with the store, the deliveries are typed `Readonly`, and a copy per listener would cost on
every change. The test of this ticket compares with the store's state, not between listeners.

## Acceptance criteria

- [ ] Given every kind of `GraphChange`, when a test drives the change and walks the delivered
      value, then no object or array in it is identical to one the store's state reaches.
- [ ] Given the fix of 5e3625ae reverted, when the test runs, then it fails, naming `nodeAdded`
      and `outline`.
- [ ] Given a kind added to `GraphChange` without a case in the test, when the type check or the
      test runs, then it fails.
- [ ] Given the arguments Comb hands each veto (`canConnect`, `canDelete`, `canMoveInto`), when
      the same walk runs over them, then none is identical to an object the store keeps.

## Read first

- Touches: `packages/comb/src/api/changes.ts`, `packages/comb/src/api/changes.test.ts`,
  `packages/comb/src/api/editors.ts`, `packages/comb/src/api/snapshot.ts`
- API-edits-report-division-moves (*Delivery*, the table of changes), API-export-apply-change
  (proposed), ARCH-graph-in-zustand-store.
- Conventions: *Hand the host copies*, *Break the feature once, and watch its test fail*.
- The seam: `packages/comb/src/api/changes.test.ts` and `graph-change.test.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches `packages/comb/src/api/`, the public interface the maintainer reviews,
and whether a veto's arguments must be copies too is the maintainer's call where one is not.
