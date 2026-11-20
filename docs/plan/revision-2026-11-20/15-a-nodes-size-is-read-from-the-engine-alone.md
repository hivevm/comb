# Ticket: The shell reads a node's size from the engine alone

## What to build

The store keeps a node's `width` and `height` in `NodeView` (`packages/comb/src/store/index.ts`),
copied back from the engine by `api/editors.ts` in three places, by `api/changes.ts`, and by the
store's `resizedFrom` at a release. Readers mix the two sources:
`packages/comb/src/render/connectors.ts` and `packages/comb/src/render/particles.ts` take the width
from the store and the height from the engine's buffer, and `packages/comb/src/render/nodes.ts`
works around the gap ("held to the node's width, which a resize changes before the engine hands the
next one over"). ARCH-graph-in-zustand-store keeps every coordinate out of the store, and the engine
owns the geometry.

Evidence: the review of ticket 04 of uml-diagrams, finding 11: the store's `NodeView.height` went
stale after a resize; dcd0506c fixed it by one more write.

Let `NodeView` hold no size, at most whether the host gave a height, and let every reader take a
node's size from the engine's buffers.

## Acceptance criteria

- [ ] Given `NodeView`, when it is read, then it has no `width` and no `height`, and `nodeResized`
      carries no size into the store.
- [ ] Given a node being resized, when a browser test hovers its connectors in a frame of the
      resize, then they lie on the box drawn in that frame.
- [ ] Given the deliveries of `nodeResized` and `nodeAdded`, when their browser and unit tests run,
      then they pass unchanged.

## Read first

- Touches: `packages/comb/src/store/index.ts`, `packages/comb/src/api/editors.ts`,
  `packages/comb/src/api/changes.ts`, `packages/comb/src/render/connectors.ts`,
  `packages/comb/src/render/particles.ts`, `packages/comb/src/render/nodes.ts`
- ARCH-graph-in-zustand-store, API-edits-report-nested-changes, REN-moving-layer-moves-content.
- The seam: `packages/comb/src/store/store.test.ts`, and
  `examples/metric-tree/e2e/resize.spec.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches `api`, a protected part the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
