# Ticket: Split the scene module and give each shared number one home

## What to build

`packages/comb/src/render/scene.ts` (440 lines) holds the pool of bindings, the node views and
their layer, the edge-label views and their layer, the snapshot type of `inspect()`, the level
of detail, the culling rectangle, the rule for moving the world alone, and `Scene`; the edges
and the particles have files of their own, nodes and labels do not. Around it, logic written
more than once:

- the world-to-screen transform, in `interaction/index.ts`, `render/scene.ts` (`cullingRect`),
  `examples/metric-tree/e2e/example.spec.ts` (`screenCentre`, `drawnBeyond`) and
  `bench/run.ts` (`nodeNearCentre`, `emptyPoint`);
- the default edge colour `0x9aa1ad`, applied in `api/index.ts` (importing it from
  `render/edges.ts`) and again in `render/scene.ts`;
- `Rect` (`bridge/index.ts`) and `Bounds` (`interaction/viewport.ts`), one shape twice.

## Acceptance criteria

- [ ] Given the render layer, when the ticket closes, then nodes and edge labels each have a
      module beside `edges.ts` and `particles.ts`, the pool one of its own, and
      `docs/ARCHITECTURE.md` names them.
- [ ] Given the shell, when the ticket closes, then the transform, the default colour, and the
      rectangle type each exist once, and the browser tests and the benchmark use the
      one transform, exposed to them through `comb/testing`, rather than a copy.
- [ ] Given the suite, when it runs, then it passes unchanged apart from imports.

## Read first

- ADR-0012 (layers), ADR-0009 (the shell's modules), and
  [`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done):
  a structure change updates the overview.
- `packages/comb/src/render/scene.ts`, `packages/comb/src/testing.ts`.

## Blocked by

- docs/plan/revision-2026-10-18/02-adr-0012-revision.md

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is `packages/comb/src/` apart from `api/index.ts`'s exports, the example's tests, and
  `bench/run.ts`; interface-preserving, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, or when a change would need a decision
  no ADR in force states, the session leaves its state here and hands off.
