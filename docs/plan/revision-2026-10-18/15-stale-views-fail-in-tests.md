# Ticket: Make a typed-array view kept across an engine call fail in tests

## What to build

ADR-0010 forbids keeping a typed-array view across a call into the engine; the edge-mesh work
read one after another engine call anyway, and only review caught it, because a stale view goes
stale only when the engine's memory happens to grow. In the test build, the bridge grows the
engine's memory before every call it makes, so every view kept across a call is detached and
reads empty, and the suite fails where the mistake is.

## Acceptance criteria

- [ ] Given the bridge in test mode, when any engine call returns, then the engine's memory has
      grown, and a Bun test shows a view taken before the call reads empty after it.
- [ ] Given the browser tests and Bun tests, when they run in test mode, then they pass.
- [ ] Given a deliberate stale read put back into `render/edges.ts`, when the suite runs in test
      mode, then it fails.
- [ ] Given the production bundle, when `scripts/check-bundle.sh` runs, then the test mode adds
      nothing to it.

## Read first

- ADR-0010 (*Views*), `packages/comb/src/bridge/index.ts` and `bridge.test.ts` (the
  memory-growth tests).

## Blocked by

- docs/plan/revision-2026-10-18/09-narrow-the-query-export.md

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is `packages/comb/src/bridge/` without a change to its exports or data format, and the
  test setup, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, or when a change would need a decision
  no ADR in force states, the session leaves its state here and hands off.
