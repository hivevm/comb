# Ticket: The store builds its maps in one loop each, and the snapshot looks for lone surrogates only where one may stand

## What to build

A load reaches its first frame sooner because two steps of the shell stop doing work twice.

- **The store.** `loadedFrom` in `packages/comb/src/store/index.ts` builds `slots` and
  `edgeSlots` through `map`, an array of pairs, and then a `Map`, one array of pairs per map.
  Build each `Map` in one loop over the snapshot's nodes and edges, setting each identifier's slot
  directly. The CPU timing puts the store's `load` at 17.5 ms of a load of 50,010 nodes and
  edges, against 5.8 ms before every field crossed for its check.
- **The snapshot.** `cut` in `packages/comb/src/api/snapshot.ts` runs the regular expression
  `LONE_SURROGATE` over every identifier, title, label text, arrowhead, and side. Put a cheap test
  before it, such as whether the string holds any code unit from U+D800 to U+DFFF at all (or
  `String.prototype.isWellFormed`, where `tsconfig.json`'s `lib` and the supported browsers have
  it), so that the expression runs only on a string that may hold a lone surrogate. The snapshot
  went from 1.6 to 10.4 ms in the timing; the expression and the spreads of `optional` in
  `edgeOf` are part of that. Keep the spreads unless the timing shows they matter.

Together the timing expects about 1 to 3 ms less. This is a refactoring within ADR-0028 and
ADR-0029: the store keeps the same state, and the snapshot hands over the same values.

**The timing.** As in
`docs/plan/first-frame/01-the-bridge-checks-each-field-as-it-reads-it.md`: the steps of a load on
`metricTree(3334)` of `examples/metric-tree/src/graph.ts`, in headless Chromium without a GPU, 25
cold runs, medians per step, this branch and `main` in the same session; the harness under
`.scratch/`, its numbers in the pull request.

## Acceptance criteria

- [ ] Given the suites of `packages/comb/src/store/store.test.ts`,
      `packages/comb/src/api/editors.test.ts`, and the browser tests of
      `examples/metric-tree/e2e/malformed.spec.ts`, when they run unchanged, then they pass: a
      lone surrogate in an identifier and in a title is still refused through the public
      interface.
- [ ] Given strings with a lone high surrogate at the end, a lone low surrogate at the start, a
      well-formed pair, and no surrogate, when the snapshot reads them, then it hands over `false`
      for the first two and the string for the others; a test in
      `packages/comb/src/api/editors.test.ts` or beside the snapshot pins it if none does.
- [ ] Given the timing, when this branch and `main` are timed in the same session, then the
      medians of the snapshot and of the store's `load` together fall by at least 1 ms and no
      step's grows.

## Read first

- ADR-0028 (*What the bridge cannot see*, *Shell*), ADR-0029 (the store), ADR-0022 (the map from
  identifiers to slots), ADR-0007 (protected parts).
- `packages/comb/src/api/snapshot.ts` (`cut`, `readerOf`, `edgeOf`, `optional`),
  `packages/comb/src/store/index.ts` (`loadedFrom`).

## Blocked by

- None (can start immediately)

## Mode

with the human: `packages/comb/src/api/snapshot.ts` lies in `packages/comb/src/api/`, a protected
part of ADR-0007, and the effect is decided by a timing, not by a test.
