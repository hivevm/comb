# Ticket: A removal of nodes and one of edges are two edits, not one behind a flag

## What to build

Moving every edit into `api/editors.ts` made the two removals one function, `remove(editing,
list, ids, by)`, whose `list: "nodes" | "edges"` it branches on four times: to read, to resolve,
to call the engine, and to record. Interaction no longer sees the flag: `deleteSelection` hands
the `Deletion` it finds, nodes and edges, to the user's deletion `editorsOf` gives (`Delete` in
`interaction/delete.ts`), which asks `canDelete` and then picks the flag itself from whether the
deletion names nodes. Before the move the removals were two functions (`nodeRemoverOf`,
`edgeRemoverOf`). What is left is in `api/editors.ts`: write the two removals as two edits of the
one pipeline that share what they share (the read of the identifier list, the slots of the
identifiers), and have the user's deletion call the one its `Deletion` names.

## Acceptance criteria

- [ ] Given `api/editors.ts`, when it is read, then no edit takes a parameter that selects between
      nodes and edges.
- [ ] Given the tests of `api/editors.test.ts`, `interaction/delete.test.ts`, and the browser tests
      of `remove.spec.ts` and `delete.spec.ts`, when they run, then they pass unchanged in what
      they assert.
- [ ] Given `bun run test`, when it runs, then it passes.

## Read first

- ADR-0030 (*Deleting*, `by: "user"`), ADR-0022 (the edges at a node named before anything is
  removed).
- `packages/comb/src/api/editors.ts` (`remove`, `editorsOf` and the user's deletion in it),
  `interaction/delete.ts` (`Delete`, `deleteSelection`); the golden path is the other edits of
  `editors.ts`.

## Blocked by

- docs/plan/revision-2026-10-25/02-a-veto-that-changes-the-graph-ends-both-gestures-alike.md

## Mode

unattended: an interface-preserving refactoring that the existing suite decides; it touches no
part the harness ADR keeps with the human (ADR-0007), and one revert undoes it; a test that has to
change what it asserts shows it wrong. Stop: where a test's assertion would have to change, hand
off.
