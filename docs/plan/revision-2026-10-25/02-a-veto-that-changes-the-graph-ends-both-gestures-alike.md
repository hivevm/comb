# Ticket: A veto that changes the graph ends both gestures alike

## What to build

ADR-0023 lets the host refuse a user's connection (`canConnect`) and deletion (`canDelete`), and
`docs/CONVENTIONS.md` (*Host code may change the graph*) asks that after a veto returns, Comb
decides from the graph as it stands then. The two vetoes do it differently, from two layers:

- the deletion's veto runs in `interaction/delete.ts` (`deleteSelection`), which deletes nothing,
  silently, where `canDelete` changed the graph itself (`change !== before`);
- the connection's veto runs in `api/index.ts` (`connectorOf`), which adds the edge whatever
  `canConnect` did: a `canConnect` that removed the source or target throws `missingNode` from the
  pointer's release, and one that added an edge between the two itself gets a second edge from the
  user's gesture beside it.

ADR-0023 decides neither case. Decide with the maintainer what a veto that changed the graph
means, the same for both, and move both vetoes beside `user` in `api/editors.ts`, which already
holds the order of every edit, so that the rule after a veto stands in one place.

## Acceptance criteria

- [ ] Given a `canConnect` that removes the connection's target and returns an identifier, when the
      user releases over it, then Comb does what the maintainer decided, the same as a `canDelete`
      that changes the graph, and no error escapes as a page error unless that is the decision.
- [ ] Given a `canConnect` that adds an edge between the two nodes itself, when it returns another
      identifier, then the result is the one decided, and a browser test pins it.
- [ ] Given the code, when it is read, then both vetoes are asked from one module and the rule
      after a veto is written once.
- [ ] Given `bun run test`, when it runs, then it passes.

## Read first

- ADR-0023 (*Vetoes*, *The user's edge*, *Deleting*), ADR-0024 (*Compatible*), ADR-0028
  (*What the bridge cannot see*); `docs/CONVENTIONS.md` (*Host code may change the graph*).
- `packages/comb/src/api/index.ts` (`connectorOf`), `api/editors.ts` (`editorsOf`, `user`),
  `interaction/delete.ts` (`deleteSelection`), `interaction/connect.ts` (`endConnection`).

## Blocked by

- None (can start immediately)

## Mode

with the human: what a veto that changed the graph means is behaviour ADR-0023 leaves open, and
the choice may call for a revision of it.
