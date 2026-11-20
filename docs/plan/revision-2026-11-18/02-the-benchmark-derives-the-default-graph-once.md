# Ticket: The benchmark derives what the default graph omits in one place

## What to build

Ticket 11 of `docs/plan/revision-2026-11-07/` (80f29347) named the benchmark's default graph once,
as `DEFAULT_GRAPH` of `bench/options.ts`, with `graphSuffix` and `graphPhrase` for "the two
derivations every caller wrote by hand". Four callers still write the rule that the default graph
is omitted by hand:

- `bench/compare.ts`, where it writes the graph of a median only when it is not the default, and
  where it names a baseline's graph in a refusal;
- `bench/compare.ts`, `graphOf`, which falls back to the default where a run names no graph;
- `bench/run.ts`, which adds `&graph=` to the example's URL only for another graph.

The graph names stand twice besides, in `bench/options.ts` and in
`examples/metric-tree/src/main.ts`, tied only by a type the benchmark checks, and the example parses
the `"shaped"` literal again.

The header comment of `bench/run.ts` has lost its columns since a reflow:
`BENCH_CPU_THROTTLE=2` and `BENCH_GRAPH=shaped` run into one paragraph with their ADRs.

Let each derivation of the default graph stand once in `bench/options.ts`, the callers use it, and
the header list its variables in its columns again.

## Acceptance criteria

- [ ] Given `bench/compare.ts` and `bench/run.ts`, when a reader searches them for
      `DEFAULT_GRAPH`, then neither compares a graph with it; `bench/options.ts` alone does, and a
      test beside it covers each derivation.
- [ ] Given a run and a median of each graph, when `bun test bench` runs, then the comparison's
      output, the median's file, and the example's URL are what they are today.
- [ ] Given the header comment of `bench/run.ts`, when it is read, then each variable stands in
      the column of the others, with its ADR on a line of its own beneath.

## Read first

- Touches: `bench/options.ts`, `bench/compare.ts`, `bench/run.ts`, `bench/options.test.ts`,
  `bench/compare.test.ts`
- PERF-benchmark-measures-named-graph; the **Benchmark** part of `docs/ARCHITECTURE.md`.
- The golden path: `graphSuffix` and `graphPhrase` of `bench/options.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the benchmark's comparison, whose exit codes the Benchmark workflow
gates on, and the harness ADR's cap on open agent work is the maintainer's to weigh.
