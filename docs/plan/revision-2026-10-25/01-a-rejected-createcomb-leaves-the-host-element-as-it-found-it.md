# Ticket: A rejected `createComb` leaves the host element as it found it

## What to build

Moving the editors into `api/editors.ts` had `createComb` read the bridge's limits after PixiJS had
put its canvas into the host element. Reading a limit calls the engine, which another Comb's trap
on the page has lost (ADR-0021), so `createComb` rejected and left a canvas and a running
application behind. Commit ac2cb91 moved the read back before anything touches the host element,
but shipped no regression test: the browser test that creates a second Comb after a trap
(`examples/metric-tree/e2e/engine-lost.spec.ts`) asserts the `EngineLostError` and not the host
element it was handed.

Assert that a `createComb` refused because the engine is lost adds nothing to its host element,
and that a refusal for a missing engine does the same, as `api/engine.test.ts` already does for
the latter.

The maintainer changed the first criterion: `createBridge` refuses an engine lost before
`createComb` runs, before the limits are read, so only a loss while PixiJS initialises tells the
two orders apart. There ac2cb91's order lets `createComb` resolve. The test of an engine lost
before the call lands too, as the regression test of `createBridge`'s own refusal.

## Acceptance criteria

- [ ] Given the engine lost while PixiJS initialises, when `createComb` runs, then it resolves,
      or rejects leaving its host element without a child (`Verifies: ADR-0021`).
- [ ] Broken once: with the limits read after the renderer is created, as before ac2cb91, the test
      fails.
- [ ] Given `bun run test`, when it runs, then it passes.

## Read first

- ADR-0021 (*Decision*, *Enforcement*), ADR-0019 (`createComb` refuses before it touches the host
  element).
- `packages/comb/src/api/index.ts` (`createComb`), `api/engine.test.ts` (the stand-in host),
  `examples/metric-tree/e2e/engine-lost.spec.ts` (`secondHost`).

## Blocked by

- None (can start immediately)

## Mode

unattended: a test decides it (the criteria above); it adds one assertion or test and touches no
part the harness ADR keeps with the human (ADR-0007), so a wrong result costs one revert; the
broken-once run proves it right and a red suite shows it wrong. Stop: if the assertion cannot be
made to fail by undoing ac2cb91's order within two attempts, hand off with what was tried.
