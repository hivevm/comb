# Ticket: One hit test and one viewport arithmetic for every reader

## What to build

ADR-0025 asks for one call that answers every hit test. Two paths lead to it in the shell:
interaction's `targetAt` (`interaction/index.ts`), from the store's viewport, and the scene's
`hitKind` (`render/scene.ts`), with `toWorld` written inline from the drawn viewport, which the
testing entry exposes with a `connectors` flag its callers pass by hand (`testing.ts`,
`bench/run.ts`), though the Comb knows whether it may connect. The render layer imports the
viewport's arithmetic from `interaction/viewport.ts`, a dependency from render onto interaction,
and `render/connectors.ts` writes `toScreen` out once more. The connectors layer computes a
connector's point itself (`connectorPoint`), beside the engine's, which the hit test uses; a change
of the side rule would move one and not the other. Each probe of the testing entry also costs a
`Scene` method, a `Window` declaration, and a forwarder in the example.

Let the testing entry ask interaction's hit test, with the Comb's own answer to whether it may
connect, and drop `Scene.hitKind` and the flag; move the viewport's arithmetic to a module that
render, interaction, `api`, and the testing entry all import, and use it at the inline sites; take
connector points from the engine, or pin the shell's copy to the engine's by a test.

## Acceptance criteria

- [ ] Given a point over a connector, a label, a node, an edge, and nothing, when the testing entry
      and a press ask what it hits, then both answer from one function.
- [ ] Given `packages/comb/src/render/`, when it is read, then it imports nothing from
      `interaction/`.
- [ ] Given each of the four sides, when a connector is drawn and hit, then its drawn point and
      the engine's agree (`Verifies: ADR-0024`).
- [ ] Given the browser tests and the benchmark's checks of its gestures, when they run, then they
      pass, the benchmark without passing a flag.

## Read first

- ADR-0025 (*One call*), ADR-0024 (*Drawing*), ADR-0026 (*Direction*), ADR-0027.
- `packages/comb/src/interaction/index.ts`, `interaction/viewport.ts`, `render/scene.ts`,
  `render/connectors.ts`, `packages/comb/src/testing.ts`, `bench/run.ts`,
  `examples/metric-tree/src/main.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the hit test's flag is decided by ADR-0025 (*Connector*), and `bench/run.ts`
asks the hit test where its pans begin.
