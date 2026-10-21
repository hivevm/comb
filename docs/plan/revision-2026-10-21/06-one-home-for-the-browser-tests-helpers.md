# Ticket: One home for what the browser tests share, and a file per criterion

## What to build

`open`, which opens the example and waits until its first load has drawn, is written three times:
as functions in `example.spec.ts` and `malformed.spec.ts`, and inline in `hostile-text.spec.ts`.
`policy.spec.ts` waits differently on purpose, for the load or a violation, and keeps its own.
`example.spec.ts` has grown to 863 lines, holding the golden path, culling, the levels of detail,
the work per frame, the reference image, the engine's forms, and drag, pan, and zoom; each spec
adds to it. `open` and the helpers the split leaves used by more than one file (`screenCentre`,
`canvasOrigin`, `inkNear`, `setViewport`, `pan`, as it falls out) move into one module under
`e2e/`, and `example.spec.ts` splits into files by what they verify. No assertion changes.

## Acceptance criteria

- [ ] Given the browser tests, when they are searched, then opening the example and waiting for
      its first load is written once, apart from `policy.spec.ts`'s wait for a violation.
- [ ] Given the split, when the suite runs, then the same tests run with the same names and the
      same `Verifies:` markers, and `scripts/sensor-tests-kept.sh` reports none removed.
- [ ] Given each new spec file, when it is read, then it verifies one criterion or one ADR, or the
      golden path.

## Read first

- `examples/metric-tree/e2e/` whole; `docs/CONVENTIONS.md`.
- ADR-0002 (*Verifies* markers), ADR-0008.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the suite runs the same tests, by name and marker, before and
  after;
- scope: the browser tests alone, a mechanical move; one revert undoes it;
- cap: it counts as one of the two pieces of open agent work ADR-0007 allows, and starts only
  when fewer than two are open;
- no protected part of ADR-0007;
- a wrong result shows as a test missing from the list `bunx --bun playwright test --list`
  printed before the move, or a red one; the two lists compared prove it right;
- stop: if a helper differs between its copies in what it waits for, hand off with the
  difference rather than pick one.
