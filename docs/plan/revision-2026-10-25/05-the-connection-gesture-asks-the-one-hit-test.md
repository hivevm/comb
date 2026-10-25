# Ticket: The connection gesture asks the one hit test the press and the hover ask

## What to build

Ticket 15 of the revision of 2026-10-24 made `hitAt` of `attachInteraction` the one hit test, which
the press, the hover, and the testing entry ask with connectors where `CombOptions.canConnect` is
set (ADR-0025, *Connectors asked for*). The connection gesture, `interaction/connect.ts`, calls
`targetAt(context, x, y, true)` itself on every move instead; the two agree only because a
connection exists only where connecting is allowed. And the gestures' `Context`
(`interaction/gesture.ts`) carries `pointer` for this one gesture while `begin` takes `hitAt` and
`connect` beside it.

Hand the gestures `hitAt` through their `Context`, so that the connection asks it as the press
does, and name the store's `pointerWithout` and its local `pointer` (`store/index.ts`) after what
they hold, the node under the pointer and the connection, so that `pointer` means interaction's
point alone.

## Acceptance criteria

- [ ] Given `interaction/`, when it is read, then `targetAt` is called from one place, the function
      `hitAt` is.
- [ ] Given the tests of `interaction/interaction.test.ts` and the browser tests of
      `connect.spec.ts`, when they run, then they pass unchanged in what they assert.
- [ ] Broken once: with `hitAt` asking connectors never, the connection's tests fail.

## Read first

- ADR-0025 (*Connectors asked for*, *One call*), ADR-0024; ADR-0029 (proposed: where the pointer's
  point lives).
- `packages/comb/src/interaction/gesture.ts` (`Context`, `targetAt`), `interaction/index.ts`
  (`begin`, `attachInteraction`), `interaction/connect.ts`, `store/index.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended: an interface-preserving refactoring inside interaction, decided by the suite and the
broken-once run; no part the harness ADR keeps with the human (ADR-0007), one revert undoes it.
Stop: where a test's assertion would have to change, hand off.
