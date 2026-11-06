# ADR-0033: The benchmark measures the graph a run names, the metric tree or a shaped one, each against baselines of its own

- **Status:** 🟡 proposed
- **Date:** 2026-11-06
- **Deciders:** Markus Brigl
- **Applies to:** `bench/run.ts`, `bench/compare.ts`, `bench/options.ts` and their tests under `bench/`, `bench/baselines/`, `.github/workflows/benchmark.yml`, the query of the metric tree's example in `examples/metric-tree/src/`, and the **Benchmark** part of `README.md`

## Context

The benchmark measures one graph: the metric tree at 50,010 nodes, served from the example's
production build. `bench/compare.ts` compares the median of runs with the baseline of the
runner's kind, `bench/baselines/<kind>.json`, and refuses a run of another size, mode, or GPU
(read on 2026-11-06). Q-1 and Q-2 are measured for that graph alone.

The feature spec `docs/plan/state-diagram/` adds node shapes, edges docked on the outline, and
loops. The maintainer asked that Q-1 and Q-2 hold for a graph that uses them, measured, not
assumed. The forces:

- **Comparability:** a run of a shaped graph is slower or faster than one of the metric tree
  for reasons no runner explains. Compared with the metric tree's baseline, it would trip the
  margin or hide a regression. Each graph needs baselines of its own.
- **What exists stays:** the metric tree's runs, its baselines, and the workflow's three runs
  stay as they are. A run that names no graph is a run of the metric tree.
- **ADR-0028 and ADR-0029:** a run may attach to a Chrome on the host and slow its CPU, and
  records both. A third choice of the run belongs in the same record and the same refusals.
- **The gestures:** drag, pan, zoom, and edits, at the fitted view and at each level, are
  measured on any graph of the same size, so the shaped graph keeps the metric tree's layout and
  size.

## Decision

We will let a run of the benchmark name the graph it measures:
- `metric-tree`, the default;
- `shaped`, the metric tree at the same size, whose nodes take the node shapes in turn, whose
  edges dock on the outline, and of whose nodes one in a hundred has a loop.

A run records that name, and is compared only with baselines of its runner kind and its graph.

- **Choosing:**
  - `BENCH_GRAPH` names the graph. `bench/options.ts` reads it as it reads the other variables,
    and refuses a value outside the two.
  - The run opens the example with `?graph=shaped` where it names `shaped`. The example builds
    the shaped graph from the metric tree's copies, the same nodes and edges in the same places,
    and allows loops for it.
  - Without the query, the example is the metric tree as today.
- **Recording:** a run records `graph` beside its size, mode, GPU, attachment, and CPU slowdown.
- **Comparing:**
  - The metric tree's baselines stay `bench/baselines/<kind>.json`. The shaped graph's are
    `bench/baselines/<kind>.shaped.json`.
  - `bench/compare.ts` compares a run with the baseline of its kind and graph. It refuses:
    - a run of another graph than the baseline's;
    - a median of runs of different graphs;
    - a run of a graph without a baseline on its kind, naming the file the baseline would be
      saved as.
- **The workflow:** the **Benchmark** workflow runs each graph three times on its runner and
  compares each median with its own baseline, weekly and on demand. The shaped graph's comparison
  gates the workflow only where its baseline exists on the runner's kind; where none exists, the
  workflow reports the shaped graph's median and the file its baseline would be saved as, and
  fails on the metric tree alone. A shaped run that fails, rather than measures slow, fails the
  workflow on every kind. The metric tree is compared before the shaped graph runs, so its
  comparison is reported either way.

**Out of scope:** other graphs, such as a UML diagram at scale or graphs of other sizes, and a
benchmark of the UML example; the reference workload, which stays one per run.

## Alternatives considered

- **Every run measures both graphs** — nothing can be forgotten, but every run, local ones
  included, takes twice as long, and a run attached to a Chrome on the host blocks it twice as
  long.
- **The shaped graph from the UML example** — it shows node shapes where they are meant, but the
  benchmark would build and serve a second example, at a size no UML diagram has, with gestures
  that differ from the metric tree's.
- **One baseline file per kind holding both graphs** — fewer files, but the files are medians of
  runs as `bench/compare.ts` writes them, and recording a baseline would turn from saving a file
  into merging one.
- **No measurement, Q-1 and Q-2 assumed for shaped graphs** — the maintainer declined: the
  engine's crossing and the loops add work per edge that no existing run exercises.

## Sources / Prior art

- `bench/run.ts`, `bench/compare.ts`, `bench/options.ts`, `bench/baselines/`, and
  `.github/workflows/benchmark.yml`, with ADR-0028 and ADR-0029 (read on 2026-11-06).

## Consequences

- Positive: Q-1 and Q-2 are measured for a graph of node shapes, docking, and loops, and a
  regression there is seen as it is for the metric tree.
- Positive: the metric tree's runs and baselines stay valid as they are.
- Negative / trade-offs: the workflow runs twice as long, and every runner kind needs a second
  baseline, which the maintainer records as the first.
- Negative / trade-offs: the metric tree's example gains a query that only the benchmark uses.
- Follow-ups: the maintainer records the shaped graph's baselines on each runner kind.

## Enforcement

Each test below cites this decision with `Verifies:` and its identifier.

- **Choosing:** a test of `bench/options.ts` asserts that `BENCH_GRAPH` defaults to
  `metric-tree`, takes `shaped`, and refuses anything else.
- **Comparing:** tests of `bench/compare.ts` assert:
  - that a run is compared with the baseline of its kind and graph;
  - that a run of another graph, a median of mixed graphs, and a graph without a baseline are
    refused, the last naming its file.
- **The graph:** a browser test of the metric tree's example, on its production build, asserts
  that `?graph=shaped` loads 50,010 nodes in the node shapes in turn, edges docked on the outline,
  and a loop on one node in a hundred. It asserts that without the query the graph is today's.
- **The workflow:** tests of `.github/workflows/benchmark.yml` assert that the metric tree's
  comparison fails on every refusal, that the shaped graph's passes where its kind has no
  baseline and reports its median, and that the metric tree is compared before the shaped graph
  runs, whose steps run whether that comparison passes or not.
