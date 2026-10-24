# Ticket: Each test-mode seam has a marker of its own, and no shipped build carries one

## What to build

Test mode has two seams: `detaching` in `packages/comb/src/bridge/index.ts` grows the engine's
memory before every call (ADR-0010), and the trap of ADR-0021, an export of the bridge crate
built with its feature `test-mode`, armed by `trapNextCall`. `scripts/check-bundle.sh` fails a
library bundle that carries the string `Comb test mode` and an engine file that names
`comb_test_mode_trap`, and with no arguments checks that it recognises both in builds that carry
them. Four gaps:

- `Comb test mode` stands in two messages, `detaching`'s and `trapNextCall`'s. With
  `detaching`'s reworded, the positive control still finds the other, and a bundle that carried
  `detaching` would pass. Each seam needs a marker of its own, named once in the source as a
  constant the check and its self-test look for.
- The example's production build, which the benchmark measures and the tests tagged `@built`
  run, is checked by nothing; it imports `comb/testing`. Neither `bench/run.ts` nor a `@built`
  test asserts `testMode()` is `false`, though a benchmark in test mode would time a memory grow
  per engine call (*A number says where it was taken*).
- The example hands over the test-mode engine with the production glue, which holds while the
  feature adds no `#[wasm_bindgen]` export; nothing compares the two generated `engine.js`.
- The self-test passes a directory every time, so the branches of the no-argument run (the build
  failing, the engine not found among the exports, the two "does not recognise" failures) are
  never run.

## Acceptance criteria

- [ ] Given a library bundle carrying `detaching` but not `trapNextCall`, or the reverse, when the
      bundle check runs, then it fails naming the seam; its self-test holds both.
- [ ] Given the benchmark and a `@built` test, when they open the example's build, then each
      asserts `testMode()` is `false` before it records anything.
- [ ] Given the two engine builds, when the bundle check runs without arguments, then it fails
      where `wasm/engine.js` and `wasm/test-mode/engine.js` differ.
- [ ] Given the self-test, when it runs, then each failure branch of the no-argument run is run
      once, with a stand-in for the build where a real one is too slow.
- [ ] Broken once: with `detaching`'s marker removed from its message, the positive control fails.

## Read first

- ADR-0010 (*Views*, test mode in its Enforcement); ADR-0021 (*Tests*); ADR-0019 (the library
  build, `scripts/check-bundle.sh`).
- `packages/comb/src/bridge/index.ts` (`TEST_MODE`, `detaching`, `trapNextCall`, `wrap`),
  `examples/metric-tree/vite.config.ts`, `bench/run.ts` (`measure`),
  `examples/metric-tree/e2e/policy.spec.ts` (the `@built` test).
- `scripts/check-bundle.sh`, `scripts/test-check-bundle.sh`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches `packages/comb/src/bridge/` and `scripts/check-bundle.sh` with its
self-test, protected parts of ADR-0007.
