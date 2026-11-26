# nodeAdded hands its listeners the outline the store keeps

- **Observed:** the delivery of `nodeAdded` sets the node's `outline` to the tuple of the store's
  node view, by reference, for a border node and for a placed node alike. A listener that changes
  the dash and gap of that tuple changes what the store keeps of the node.
  API-edits-report-nested-changes asks for copies no listener can reach into. Ticket 16 of
  revision-2026-11-20 closed the same leak for `nodeUpdated`, which now copies the tuple in
  `NODE_PATCH_READS`.
- **Where:** `nodeAddedOf` in `packages/comb/src/api/changes.ts`, the two lines that set
  `border.outline` and `node.outline`.
