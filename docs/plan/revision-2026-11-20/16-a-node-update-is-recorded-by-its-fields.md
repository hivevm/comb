# Ticket: The store records a node's update by the fields it changed, and one table delivers them

## What to build

A change of `updateNode` is threaded field by field through four layers:

- `sizingOf` in `packages/comb/src/api/editors.ts`;
- `NodeSizing` in `packages/comb/src/store/index.ts`, which carries flags such as `side?: true` and
  `offset?: true`;
- the store's `updatedFrom` and `updateOf`, and the flags of `StoreChange.nodeUpdated`;
- `nodeUpdatedOf` and `placePatched` in `packages/comb/src/api/changes.ts`.

The store's action has grown to `updateNode(id, content, sizing?, divided?)`, and the record step of
`updateNode` in `editors.ts` calls `removeNodes`, `updateNode`, `nodeMoved` once per node, and
`positionsMoved` in turn.

Evidence: tickets 04, 05, 06, and 07 of uml-diagrams each added one field in all four places, as
their hand-offs list. The review of ticket 04, finding 9: folding `nodeChangeOf` into `deliveryOf`
passed ESLint's limit of complexity.

Let the store record `nodeUpdated` as the node and the list of the fields of `NodePatch` it changed,
with the division where it changed, and let the delivery build the patch from one table that names
for each field where it is read.

## Acceptance criteria

- [ ] Given the keys of `NodePatch`, when a unit test enumerates them against the table, then each
      has one entry, so that a new field of a patch touches the table and the bridge alone.
- [ ] Given the store's `updateNode`, when it is read, then it takes one argument object.
- [ ] Given the browser and unit tests of `nodeUpdated`, when they run, then they pass unchanged.

## Read first

- Touches: `packages/comb/src/store/index.ts`, `packages/comb/src/api/editors.ts`,
  `packages/comb/src/api/changes.ts`
- API-edits-report-nested-changes, ARCH-graph-in-zustand-store.
- The seam: `packages/comb/src/store/store.test.ts` and the browser tests of `nodeUpdated` in
  `examples/metric-tree/e2e/`.

## Blocked by

- docs/plan/revision-2026-11-20/15-a-nodes-size-is-read-from-the-engine-alone.md

## Mode

with the human: it touches `api`, a protected part the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
