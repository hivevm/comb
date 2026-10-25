# Ticket: The report of a change to the host is a module of its own

## What to build

The edits moved into `api/editors.ts`; how a change the store records reaches `onChange` stayed in
`api/index.ts`, which is still about 500 lines: `GraphChange`, `EdgeChangePatch`,
`edgeDeliveryOf`, `deliveryOf`, and `listenersOf`. Written there a second time:
`EdgeChangePatch` re-spells the store's `EdgePatch` field by field, `"user" | "host"` re-spells
`By` three times, the read of a node's position from the engine's buffer (`positions[slot * 2]`)
stands three times, and the edge an identifier names is looked up as
`state.edges[state.edgeSlots.get(id)!]!` in two places here and two in the store.

Move the delivery of changes into a module of `api` of its own, derive its types from the store's
where they are the same, and read a node's position and an edge by identifier through one function
each. The comment of `api/index.ts` that lists the methods throwing `EngineLostError` names
`addEdge`, `updateEdge`, `removeNodes`, and `removeEdges` too, as their own documentation does.

## Acceptance criteria

- [ ] Given the exported types of `comb`, when the library's type test and its consumers compile,
      then `GraphChange` and its patch types are as before (the public interface does not change).
- [ ] Given the code, when it is read, then each of the four repeated pieces above is written once.
- [ ] Given `api/graph-change.test.ts` and the browser tests of `onChange`, when they run, then
      they pass unchanged in what they assert.

## Read first

- ADR-0030 (*Changes*, the copies handed to the host); `docs/CONVENTIONS.md` (*Hand the host
  copies*).
- `packages/comb/src/api/index.ts`, `api/editors.ts`, `store/index.ts` (`EdgePatch`, `By`).

## Blocked by

- None (can start immediately)

## Mode

unattended: an interface-preserving refactoring the suite decides; the type check refuses a change
of the public types; no part the harness ADR keeps with the human (ADR-0007) is touched, and one
revert undoes it. Stop: where an exported type would change, hand off.
