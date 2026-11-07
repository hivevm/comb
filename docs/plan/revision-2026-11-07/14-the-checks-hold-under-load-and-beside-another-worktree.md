# Ticket: The checks hold under load and beside another worktree

## What to build

Three defects showed while tickets of revision-2026-11-07 were worked on 2026-11-07. A flaky
test is a defect, not noise
([`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done)):

- **`examples/metric-tree/e2e/work-per-frame.spec.ts:52`** (*a pan within the queried rectangle
  creates, resizes, and uploads nothing, at every level*, ADR-0012) set its own timeout of 60 s
  and hit it twice under load: once beside a second worktree's Playwright run (ticket 04's commit
  alone, its browser suite 6.7 min against 3.1), once with the container's load average at 37
  from outside it (the batch of tickets 03, 08, and 05, its suite 6.7 min against 2.8). Alone it
  passes in 8 to 21 s. It pans 60 frames at each of three levels of 100 copies, waiting for each
  render.
- **`scripts/test-check-all.sh`, the case *and no check it started finishes after it*** (about
  line 271) waits up to 1 s for a stub check to start, then races the stub's `sleep 1` with a
  `sleep 1.2`; it failed once at a load average of 18 to 25 and passed alone.
- **The Playwright ports are fixed** (5174, 5175, 5177 in `playwright.config.ts`), so two
  worktrees cannot run `scripts/check-all.sh` at once: with `CI=1` the second fails "is already
  used", and without it, it would reuse the first worktree's server and test the wrong tree.

Make each test decide its claim without depending on the machine's speed (wait on the condition,
not on a fixed time, or scale what it measures), and let a run of the browser tests in one
worktree not collide with another's (ports derived from the worktree, or chosen free at start).

## Acceptance criteria

- [ ] Given `work-per-frame.spec.ts:52`, when the browser suite runs under a CPU slowed fourfold
      (the benchmark's own throttle, ADR-0029, or `taskset` to one core), then it passes, still
      asserting no creation, resize, or upload during the pans.
- [ ] Given `scripts/test-check-all.sh`, when it runs beside a busy loop on every core, then the
      case passes, and it still fails when the runner leaves a check running after it exits.
- [ ] Given two worktrees, when each runs `CI=1 scripts/check-all.sh` at once, then both test
      their own tree and neither fails on a port.

## Read first

- Touches: `examples/metric-tree/e2e/work-per-frame.spec.ts`, `scripts/test-check-all.sh`,
  `playwright.config.ts`, `scripts/check-all.sh`
- The merge messages of tickets 04, 07, and 05 of this directory, *Doubts* and *Checks*.
- ADR-0012 (*work per frame*), ADR-0002 (checks as scripts).

## Blocked by

- None (can start immediately)

## Mode

with the human: `scripts/` holds protected checks (ADR-0007), and how the ports are chosen is a
change to how every session runs the browser tests.
