# Ticket: A removal of nodes and one of edges are two edits, not one behind a flag

## What to build

Moving every edit into `api/editors.ts` made the two removals one function, `remove(editing,
list, ids, by)`, whose `list: "nodes" | "edges"` it branches on four times: to read, to resolve,
to call the engine, and to record. The flag leaks into interaction's `Remove` type
(`interaction/delete.ts`) and `deleteSelection`. Before the move they were two functions
(`nodeRemoverOf`, `edgeRemoverOf`). Write the two removals as two edits of the one pipeline that
share what they share (the read of the identifier list, the slots of the identifiers), and hand
interaction a deletion that takes nodes and edges as `deleteSelection` already finds them.

## Acceptance criteria

- [ ] Given `api/editors.ts`, when it is read, then no edit takes a parameter that selects between
      nodes and edges, and interaction's deletion type names no such flag.
- [ ] Given the tests of `api/editors.test.ts`, `interaction/delete.test.ts`, and the browser tests
      of `remove.spec.ts` and `delete.spec.ts`, when they run, then they pass unchanged in what
      they assert.
- [ ] Given `bun run test`, when it runs, then it passes.

## Read first

- ADR-0023 (*Deleting*, `by: "user"`), ADR-0022 (the edges at a node named before anything is
  removed).
- `packages/comb/src/api/editors.ts` (`remove`, `editorsOf`), `interaction/delete.ts`
  (`Remove`, `deleteSelection`); the golden path is the other edits of `editors.ts`.

## Blocked by

- docs/plan/revision-2026-10-25/02-a-veto-that-changes-the-graph-ends-both-gestures-alike.md,
  which moves the deletion's veto into the same module.

## Mode

unattended: an interface-preserving refactoring that the existing suite decides; it touches no
part the harness ADR keeps with the human (ADR-0007), and one revert undoes it; a test that has to
change what it asserts shows it wrong. Stop: where a test's assertion would have to change, hand
off.
