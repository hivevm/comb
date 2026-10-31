# Ticket: The benchmark measures the full content

## What to build

The benchmark loads the example with its full content at 50,010 nodes and times load, drag, pan,
zoom, and edits at each level of detail. Where a number of the runner's kind grows by more than
the workflow's 25 %, the profile names what costs, and the ticket fixes it or writes a ticket that
says by how much and why. The maintainer records the kind's new baseline from a workflow run on
`main`.

## Acceptance criteria

- [ ] Given `bun run bench` on the example with content, when it runs, then every gesture of today
      is timed at each level, and the result names the content it loaded.
- [ ] Given the **Benchmark** workflow against the current baseline, when it runs, then no number
      exceeds it by more than 25 %, or a ticket under `docs/plan/` says which, by how much, and
      what the profile points at.
- [ ] Given the work-per-frame counts of the scene, when the viewport pans at the near level, then
      no element view is created outside the pools' growth.

## Read first

- ADR-0008 (*Benchmark*, *Runner kind and baselines*), ADR-0027; `bench/run.ts`, the README's
  **Benchmark**; Ticket docs/plan/revision-2026-10-18/16-measure-q1-q2-on-the-reference-machine.md
  for Q-1 and Q-2 on the reference machine, which this ticket does not replace.

## Blocked by

- docs/plan/node-content/07-the-example-shows-the-metric-tree-of-g-9.md

## Mode

with the human: a new baseline is the maintainer's to record (ADR-0008), and a number past the
budget is a decision on Q-1 and the levels' thresholds (ADR-0027).

## Where it stands

- Criterion 1 is built: `bench/run.ts` times drag, pan, zoom, and edits at the fitted view the
  example opens with, under the names the baselines hold, then at each level, centred in the graph,
  the pans first (`pan near`, `pan middle`), then drag, zoom, and edits at near and middle at the
  scale where each begins. At 50,010 nodes the fitted view draws far, so its drag, pan, and edits
  are far's and far adds only `zoom far`; `fitted` in the result says which level the fitted view
  draws, and a smaller graph times all four at far. The zoom at a level stays within it. The run
  records `load.content`, the example's nodes by type and elements by kind
  (`bench/content.test.ts`), and prints it. A gesture the kind's baseline lacks is reported as `no
  baseline` and listed as new, never judged (`bench/compare.test.ts`, *the gestures at each level of
  detail*, against both baselines as recorded). The **Benchmark** workflow's timeout is 45 minutes
  for thirteen gestures a run.
- Criterion 3 holds: node views share their texts and sprites in the layer, and
  `work-per-frame.spec.ts` pans at the near level over the 50,010 nodes twice, counting every
  element view of the node views drawn; the second pan creates none.
- Criterion 2 waits for a run of `bun run bench` and of the **Benchmark** workflow against the
  current baselines; the numbers past 25 %, if any, are decided with the human (Mode).
