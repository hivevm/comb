# Ticket: A check that a frame allocates and uploads nothing it need not

## What to build

The same mistake came back three times in *Large graphs*: allocations on every move, GPU buffers
reallocated on every frame, and particles marked dynamic and uploaded on every frame. Each was
caught by a reviewer reading code; nothing measures it. `comb/testing` gains counters of what a
render did (GPU buffers created or resized, bytes uploaded, display objects created), and a
browser test drags and pans a warm scene for many frames and asserts that past the first frame
no buffer is created or resized, no display object is created while the pools hold enough, and
the particles of the far level upload nothing while no node moves.

## Acceptance criteria

- [ ] Given the example warmed up at each level, when a test pans for 60 frames within the
      queried rectangle, then no GPU buffer is created or resized and nothing is uploaded.
- [ ] Given a drag at the far level, when it runs for 60 frames, then the particle buffer is
      updated in place, never reallocated, and the counters show it.
- [ ] Given each assertion, when the old mistake is put back (the particles marked dynamic, the
      mesh buffer allocated per sync), then it fails.

## Read first

- ADR-0012 (pooling), ADR-0009 (`comb/testing` is no part of the stable interface).
- `packages/comb/src/render/edges.ts`, `render/particles.ts`, `packages/comb/src/testing.ts`.

## Blocked by

- docs/plan/revision-2026-10-18/09-narrow-the-query-export.md

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is `packages/comb/src/render/`, `packages/comb/src/testing.ts`, and the example's
  tests, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, when counting needs PixiJS internals a
  version bump would break, or when a change would need a decision no ADR in force states, the
  session leaves its state here and hands off.
