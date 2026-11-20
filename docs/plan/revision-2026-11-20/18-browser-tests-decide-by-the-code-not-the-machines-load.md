# Ticket: Browser tests decide by the code, not by the machine's load

## What to build

Several browser tests decide by elapsed time, and failed under a loaded machine with the code
unchanged:

- the refusal of a title of 50 million characters in the `REFUSALS` loop of
  `examples/metric-tree/e2e/malformed.spec.ts` asserts `expect(result.ms).toBeLessThan(500)`; a
  full run of `scripts/check-all.sh` under a load average of about 48 on 24 cores took 521.5 ms
  there and failed (the review of ticket 14 of uml-diagrams, at 2cfb0d39, on 2026-11-19);
- `examples/uml/e2e/activity-edit.spec.ts` hit Playwright's default timeout of 30 s in
  `setViewport` under load in ticket 15 (eb819bf8 split it);
- the connections test of `examples/uml/e2e/use-case-diagram.spec.ts` took 25.5 s under a load of
  about 37 in ticket 13 (2ccb6ef8 split it);
- `containers.spec.ts` and `resize.spec.ts` set 180 s, and `malformed.spec.ts` 120 s twice, with no
  margin measured.

[`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done) holds a flaky test for a
defect. Both incidents of the UML example were fixed by a split; nothing keeps the next test below
the timeout, and the refusal's limit still decides by the machine's load. This ticket is made from
the backlog entry `refusal-time-limit-fails-under-load.md`, which the design revision of 2026-11-20
deleted.

Let the refusal's test show that its text costs nothing by what the code does, such as a count of
the work the bridge does for it or a comparison with a short text in the same run, rather than by a
limit of wall-clock time. Measure each browser test's duration on an idle machine and split each
test above a share of its timeout the hand-off states.

## Acceptance criteria

- [ ] Given the refusal of a title of 50 million characters, when its test runs, then it asserts no
      limit of wall-clock time, and it fails where the refusal reads the whole text, watched fail
      against such a change.
- [ ] Given the browser tests of `examples/metric-tree/e2e/` and `examples/uml/e2e/`, when a run
      with the JSON reporter on the maintainer's idle machine is read, then no test takes more than
      a third of its timeout, 10 s of the default 30 s, and each test above it is split or named in
      the hand-off with why.

## Read first

- Touches: `examples/metric-tree/e2e/malformed.spec.ts`, `examples/uml/e2e/activity-edit.spec.ts`,
  `examples/uml/e2e/use-case-diagram.spec.ts`
- Q-7; the conventions of `docs/CONVENTIONS.md` on timed tests (*A timed gesture begins from the
  same view on every runner*).
- The seam: Playwright through `comb/testing`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the durations are measured on the maintainer's idle machine, which an unattended
session cannot ensure, and where a test sits near its timeout, splitting it or raising the timeout
is the maintainer's choice.
