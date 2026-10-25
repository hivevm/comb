# Ticket: The bridge refuses a number the shell computes as the shell's mistake

## What to build

ADR-0031 is proposed and waits for the maintainer's review. Do not start before that review: once
it is done, the ADR may be implemented while still `proposed`
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 4). Today
`hit` and `moveLabel` refuse a point that is not finite as `GraphDataProblem` `malformed`, and
`query` and `hit` refuse a pixel that is not a finite number above zero the same way, while
`translate` refuses a delta that is not finite as `TranslateError` `nonFiniteDelta`. Each becomes a
kind of one generated type of the shell's mistakes, beside `SlotError`. `TranslateError` is folded
into that type, or kept as its alias, whichever the review prefers. The documentation of the
bridge's methods and the *Bridge* entry of the overview say which type each export throws.

The browser test that ticket
docs/plan/revision-2026-10-25-b/04-a-label-drag-past-every-finite-point-moves-nothing.md writes,
and the one of 5a58413 in `far-from-the-origin.spec.ts`, are the browser tests ADR-0031's
*Enforcement* names. They then cite it.

## Acceptance criteria

- [ ] Given `hit` and `moveLabel` at a point with a NaN or an infinite coordinate, `query` and `hit`
      with a pixel that is not a finite number above zero, and `translate` with a delta that is
      not finite, when each is called, then it refuses in the type of the shell's mistakes with
      the kind that names the number, and nothing moved, in tests of
      `crates/engine-wasm/src/lib.rs` that cite ADR-0031.
- [ ] Given every refusal of graph data, when the bridge crate's tests run, then each is still a
      `GraphDataProblem` of the kind it was.
- [ ] Given the browser tests of a viewport that puts every screen point beyond any finite world
      point, when they hover, press, and drag, then no page error arises, and they cite ADR-0031.
- [ ] Broken once: with the point refused as `malformed` again, the test of the point fails.

## Read first

- ADR-0031, ADR-0010 (*Errors*), ADR-0028, ADR-0025; `crates/engine-wasm/src/lib.rs` (`point`,
  `pixel`, `TranslateRefusal`), `packages/comb/src/bridge/index.ts`,
  `packages/comb/src/interaction/gesture.ts` (`targetAt`), `interaction/label-drag.ts`.
- Conventions: *Break the feature once*, *A refusal added at the bridge is traced to the shell's
  callers*.

## Blocked by

- docs/plan/revision-2026-10-25-b/04-a-label-drag-past-every-finite-point-moves-nothing.md

## Mode

with the human: the change is the bridge's data format, `crates/engine-wasm/` and
`packages/comb/src/bridge/`, protected parts of ADR-0007, and it waits for the maintainer's review
of ADR-0031.
