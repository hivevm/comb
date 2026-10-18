# Ticket: One home for the test environment and the scene's numbers in tests

## What to build

The guard against PixiJS's Canvas 2D fallback, the mistake that made every browser test and
benchmark number of the first four tickets meaningless, lives in three places
(`api/index.ts`, `bench/run.ts`, `e2e/example.spec.ts`), and the stripping of
`WAYLAND_DISPLAY` and `DISPLAY` that makes it pass is written twice, with the same comment
(`playwright.config.ts`, `bench/run.ts`). One launcher for headless Chromium that both use
keeps them from drifting. The browser tests also hard-code the scene's numbers: the level
thresholds (0.6, 0.599, 0.3, 0.299), the culling margin (128, 256), the label reach (120), and the
rescale (1.24), where `comb/testing` already offers `levelScales` and could offer the rest; a
change of a number then breaks the tests for the wrong reason or, worse, not at all. The gesture
list is kept twice under different names (`bench/run.ts`, `bench/compare.ts`), and
`compare.ts` reports truncation only for drag, pan, and zoom, not for the level pans.

## Acceptance criteria

- [ ] Given `playwright.config.ts` and `bench/run.ts`, when either starts Chromium, then both
      take the launch options from one module, and a browser test still asserts
      `inspect().renderer === "webgl"`.
- [ ] Given the browser tests, when the ticket closes, then no threshold, margin, reach, or
      rescale of the scene is written as a literal there; each is read from `comb/testing`.
- [ ] Given a run whose level pan was truncated, when `compare.ts` reports, then it says so, and a
      Bun test shows it; both files name the gestures alike.

## Read first

- ADR-0008 (Playwright on Bun, the benchmark), ADR-0009 (`comb/testing`).
- `docs/CONVENTIONS.md` ("A number says where it was taken").
- `playwright.config.ts`, `bench/run.ts`, `bench/compare.ts`, `packages/comb/src/testing.ts`.

## Blocked by

- docs/plan/revision-2026-10-18/11-split-the-scene-module.md

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is `playwright.config.ts`, `bench/`, `packages/comb/src/testing.ts`, and the example's
  tests, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, or when a change would need a decision
  no ADR in force states, the session leaves its state here and hands off.
