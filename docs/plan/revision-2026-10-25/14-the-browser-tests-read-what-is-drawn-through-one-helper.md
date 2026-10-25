# Ticket: The browser tests read what is drawn through one helper, and load through the shared one

## What to build

Ticket 16 of the revision of 2026-10-24 moved the browser tests' page helpers into
`examples/metric-tree/e2e/shared.ts`. Left behind:

- the read of the drawn identifiers after `whenRendered`, with what Comb told, is written five
  times under different names: `state` (`delete.spec.ts`), `after` (`connect.spec.ts`), `drawn`
  (`remove.spec.ts`, `add-node.spec.ts`, `malformed.spec.ts`);
- `loadLongEdge` (`far-from-the-origin.spec.ts`) writes the node size as literals and calls
  `comb.load` itself, so the example's own copy of the graph is not the graph loaded, where the
  load is not the test's subject;
- `palette.spec.ts` rebuilds `window.told`, and `add-node.spec.ts`'s `pressOn` installs a selection
  listener beside the shared `selections()`.

Give `shared.ts` one reader of what is drawn, which each spec narrows as it needs, and have the
specs above use it, `loaded`, `node`, and the shared recorders.

It waits for ticket 15 of this directory, the lint refusing a shadowing local in the browser
tests, so that a helper moved into `shared.ts` cannot leave a local shadowing it.

## Acceptance criteria

- [ ] Given `e2e/`, when it is read, then the drawn identifiers after `whenRendered` are read by one
      helper of `shared.ts`, and no spec writes the node size as a literal.
- [ ] Given a load left in a spec, when it is read, then the load is the subject of its test, as
      the closing note of commit 6f905c9 lists them.
- [ ] Given `bun run test`, when it runs, then the browser tests pass unchanged in what they assert.

## Read first

- ADR-0002 (markers stay with their tests); `docs/ARCHITECTURE.md` (*Test pattern*,
  `e2e/shared.ts`).
- `examples/metric-tree/e2e/shared.ts` and the specs named above.

## Blocked by

- docs/plan/revision-2026-10-25/15-the-lint-refuses-a-shadowing-local-in-the-browser-tests.md

## Mode

unattended: a refactoring of tests the suite decides, no part the harness ADR keeps with the human
(ADR-0007), one revert undoes it; a spec that has to change what it asserts shows it wrong. Stop:
where an assertion would have to change, hand off.
