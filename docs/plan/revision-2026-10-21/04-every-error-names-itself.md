# Ticket: A test that every error Comb exports carries its own name

## What to build

`GraphDataError` reached `main` without a `name` of its own, so it reported itself as `Error`,
until the work on Q-7 found it; `RendererUnavailableError` and `EngineSourceError` set theirs.
Nothing would catch the next error class that forgets. A Bun test walks the exports of `comb`,
takes every class that extends `Error`, constructs each from a table of arguments, and asserts
that its `name` is the class's name and that it is an `instanceof Error`. An exported error class
the table lacks fails the test, so a new one cannot slip past it.

## Acceptance criteria

- [ ] Given every class `comb` exports that extends `Error`, when it is constructed, then its
      `name` equals its class name.
- [ ] Given a new exported error class without an entry in the table, when the test runs, then it
      fails and names the class.
- [ ] Broken once: the `name` assignment removed from `GraphDataError` fails the test.

## Read first

- `packages/comb/src/index.ts`, `packages/comb/src/api/index.ts`, `packages/comb/src/api/engine.ts`.
- `packages/comb/src/api/renderers.test.ts`, the golden path of a Bun test of the API.
- `docs/CONVENTIONS.md`: break the feature once.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria (above);
- scope: one Bun test; one revert undoes it;
- cap: it counts as one of the two pieces of open agent work ADR-0007 allows, and starts only
  when fewer than two are open;
- no protected part of ADR-0007: it tests the public interface and changes none of it;
- a wrong result shows as a red test or one that passes with the `name` removed; the broken-once
  run proves it;
- stop: if an exported error cannot be constructed without a renderer or an engine after two
  attempts, hand off with the class named.
