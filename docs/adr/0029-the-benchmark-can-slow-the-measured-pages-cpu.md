# ADR-0029: The benchmark can slow the measured page's CPU, by a factor its record names

- **Status:** 🟢 accepted
- **Date:** 2026-11-02
- **Deciders:** Markus Brigl
- **Applies to:** `bench/run.ts` and its tests under `bench/`, `bench/compare.ts`, and the **Benchmark** part of `README.md`

## Context

The reference machine of Q-1 and Q-2 is a laptop with four cores and an integrated GPU of the
class of Intel Iris Xe or AMD Radeon 680M. The machine the maintainer measures on (ADR-0028) has an
Intel UHD Graphics 770, weaker than that class, and an Intel Core i7-13700, a desktop processor of
sixteen cores that is far faster than it. A GPU-bound frame there judges Q-1 more strictly than the
reference would; the load and the first frame of Q-2, and the WebAssembly of every gesture, run on
the page's main thread and are judged too kindly. No measurement of a reference laptop exists to
set the gap by; a core of the i7-13700 is, by the maintainer's estimate, about one and a half to two
times one of a laptop processor of the Iris Xe's generation.

Chrome slows a page's CPU by a factor through the DevTools protocol,
`Emulation.setCPUThrottlingRate`, "a slowdown factor (1 is no throttle, 2 is 2x slowdown)"; it
slows the page, not the GPU process.

## Decision

We will let `bun run bench`, given `BENCH_CPU_THROTTLE`, slow the CPU of the page it measures by
that factor for the whole run, through `Emulation.setCPUThrottlingRate`, and record the factor, so
that a machine whose processor outruns the reference's stands in for it; the factor the maintainer
measures by on their machine is 2.

- **Range:** a finite number of at least 1; any other value refuses the run before it measures.
  Without the variable, nothing is slowed, as before.
- **The whole run:** the load, the first frame, every gesture, and the reference workload, so that
  every number of one run is slowed alike.
- **The record:** `cpuThrottle` beside the CPU model and the browser (ADR-0028), 1 where nothing
  was slowed; `bench/compare.ts` compares a run only with baselines of the same factor, and
  refuses another, naming both.

**Out of scope:** slowing the GPU; deriving the factor from a measurement of a reference laptop,
which a later change takes up when one exists.

## Alternatives considered

- **No throttling** — the numbers as the machine gives them; Q-2 stays indicative only on a
  processor this much faster.
- **A factor derived from the reference workload** — slowing until its JavaScript and WebAssembly
  loops take what a reference laptop takes; exact where such a laptop has been measured, and none
  has.
- **Throttling the load and the first frame alone** — Q-2 slowed, Q-1 not; but the gestures run
  WebAssembly on the same thread, and a run whose numbers are slowed unevenly compares with nothing.

## Sources / Prior art

- Chrome DevTools Protocol, `Emulation.setCPUThrottlingRate`, as Playwright 1.x types it in
  `playwright-core/types/protocol.d.ts` (checked 2026-11-02).
- The maintainer's machine as the container sees it, 2026-11-02 (ADR-0028).

## Consequences

- Positive: Q-2 and the CPU part of Q-1 are judged on a processor closer to the reference's, with
  the factor in the record for a later correction.
- Negative / trade-offs: the factor is an estimate; a run slowed by 2 that holds Q-2 says Q-2
  holds on a laptop half as fast per core as the i7-13700, nothing about one slower still.
- Negative / trade-offs: the protocol slows the page's threads in time slices, not as a slower
  core would, so caches and memory are as fast as the machine's.
- Follow-ups: the factor, once a reference laptop has been measured.

## Enforcement

A test under `bench/`, citing `Verifies: ADR-0029`, asserts that the benchmark slows the page by
the factor `BENCH_CPU_THROTTLE` gives, refuses one below 1 or not finite, records `cpuThrottle`, 1
without it, and that `bench/compare.ts` refuses a run whose factor differs from its baselines'.
