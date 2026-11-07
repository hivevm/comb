# Ticket: The benchmark names its default graph once

## What to build

Ticket 05 of the state diagram added the graph a run measures (ADR-0033). The default graph is
then a special case written about nine times: `=== "metric-tree" ? "" : …` or `?? "metric-tree"`
in `bench/options.ts`, in `bench/compare.ts` (file names, the median's name, the refusal's
phrase), and in `bench/run.ts` (the query). The list of graph names stands as `GRAPHS` in
`bench/options.ts` and again as `GraphName` in `examples/metric-tree/src/main.ts`, which ADR-0030
keeps from importing `bench`, held to each other only at run time. Smell: logic written a second
time.

Export from `bench/options.ts` one default graph and the two derivations every caller writes by
hand, the file suffix and the phrase of a graph, and use them in `bench/compare.ts` and
`bench/run.ts`. `bench/run.ts`, which already imports the example's types, asserts at compile time
that `Graph` and `GraphName` are the same type, so that a graph added on one side fails the type
checker.

## Acceptance criteria

- [ ] Given `bench/`, when it is searched for the literal `"metric-tree"`, then it stands only in
      `bench/options.ts` and in tests.
- [ ] Given a graph name added to `GRAPHS` in `bench/options.ts` alone, when `bunx tsc` runs, then
      it fails naming the difference to `GraphName`.
- [ ] Given the Bun tests under `bench/`, when they run, then they pass unchanged.

## Read first

- Touches: `bench/options.ts`, `bench/compare.ts`, `bench/run.ts`
- ADR-0033 (proposed), *Decision*; ADR-0030, for what the example may import.
- `examples/metric-tree/src/main.ts`, `GraphName`.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the Bun tests under `bench/`, unchanged, and the type checker;
- its scope is three files of `bench/`, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing Bun test or a baseline file named otherwise;
  `scripts/check-all.sh` green proves it right;
- stop: when a Bun test's assertion has to change, or `scripts/check-all.sh` is still red after
  three attempts at a fix, the session leaves its state here and hands off.
