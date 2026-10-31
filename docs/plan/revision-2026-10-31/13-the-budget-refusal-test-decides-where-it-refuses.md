# Ticket: The budget refusal test decides where it refuses, not how fast

## What to build

The browser test "load takes a million edges whose identifiers hold 63 million code units, and
refuses 66 million by the budget, quickly" (`examples/metric-tree/e2e/malformed.spec.ts`) asserts
that the refused load takes less than half the time of the accepted one, to show that the refusal
comes while reading, before the edges cross into the engine. At 66 code units an edge, the reader
crosses the budget of 64,000,000 only after about 970,000 of the 1,000,000 edges, so the refused
load reads about 97 % of what the accepted one reads, and the assertion holds only while the
engine's load of the accepted graph costs at least as much as the reading. A run measured 921 ms
against a limit of 912 ms, without any change to the code either side times; a rerun passed. A
test that passes and fails on the same code is a defect (`AGENTS.md` §5).

The test decides the rule itself: a load refused by the identifier budget is refused before any
column crosses into the engine, observed directly, for example by the bridge's load never being
called, or by the budget being crossed early enough that a timing claim has a wide margin. What it
asserts of the problem and of the graph kept stays as it is.

## Acceptance criteria

- [ ] Given a load of a million edges past the identifier budget, when it is refused, then the
      test shows that no column crossed into the engine without comparing two timings within a
      few percent of each other.
- [ ] Given the test's assertions on the problem (`idBudgetExceeded`, limit 64,000,000) and on the
      graph kept, when it runs, then they are unchanged.
- [ ] Broken once: with the budget checked only after the columns are handed to the engine, the
      test fails.

## Read first

- ADR-0028 (*Limits*), Q-7; `examples/metric-tree/e2e/malformed.spec.ts` (`budgeted` and the
  test), the snapshot's reading of identifiers in `packages/comb/src/api/snapshot.ts`, and the
  bridge's load in `packages/comb/src/bridge/index.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the test's assertion changes, and the bridge's load is a protected part of
ADR-0007.
