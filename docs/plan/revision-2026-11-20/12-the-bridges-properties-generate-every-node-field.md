# Ticket: The bridge crate's properties generate every node field and every patch field

## What to build

The property tests of `crates/engine-wasm/src/properties.rs` hold that an added node is refused
exactly as a load of it alone, and that a patch is refused as the load of its result. Their
generators do not reach the fields uml-diagrams added:

- `node()` generates no `container`, `isContainer`, `regions`, `divide`, `attachedTo`, `side`, or
  `offset`;
- `patch()` generates the keys `content`, `id`, `width`, and `x` alone, none of `height`,
  `resizable`, `outline`, `side`, `offset`, `divide`, or `regions`;
- the nesting, the regions, and the ends on edges each have a generator of their own.

So the properties never touch the fields where a load, `addNode`, and `updateNode` drifted apart
(ticket 06 of this revision).

Evidence: each ticket of uml-diagrams added a generator of its own after a review found the gap:
ticket 02, finding 3; ticket 04, finding 6 ("the property generator made no height or resizable");
ticket 05, findings 9 and D; ticket 06, finding 9; ticket 10, findings 7 and 11. The review of the
whole branch named property tests that cover one feature at a time.

Write one generator of nested graph data, with containers at any depth, regions, border nodes,
node shapes, and ends on edges, and a `patch()` that covers every field of `NodePatch`, each with
floors per clause.

## Acceptance criteria

- [ ] Given a node taken from a generated batch, when it is loaded alone, added by `addNode` with
      its container or the node it rides, and handed to `updateNode` as a patch of its fields, then
      the three accept or refuse it alike.
- [ ] Given the floors of the new generators, when the test runs, then they count cases that
      combine the nesting with regions and with border nodes.
- [ ] Given f7885b4f or 3aa033f8 reverted, when the property runs, then it fails.

## Read first

- Touches: `crates/engine-wasm/src/properties.rs`
- API-bridge-columns-carry-nesting, API-edits-report-nested-changes,
  ARCH-regions-are-container-slots, ARCH-border-nodes-ride-sides.
- The golden path: the property "an added node is refused exactly as a load of it alone" in
  `properties.rs`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate, a protected part the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
