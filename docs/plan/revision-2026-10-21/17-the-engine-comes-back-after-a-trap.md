# Ticket: The engine comes back after a trap

## What to build

When WebAssembly traps inside an engine call (`unreachable` when memory runs out, an out-of-bounds
access after a leaked shadow stack), the `Engine` object stays borrowed, and every later call fails
with the untyped `Error: recursive use of an object detected which would lead to unsafe aliasing in
rust`: `load`, `updateNode`, and every render. The page keeps a canvas that no longer draws, and no
`GraphDataError` tells the host application why. The engine is instantiated once per page: the glue
of wasm-bindgen caches its instance (`__wbg_init` in `packages/comb/wasm/engine.js`, described in
`docs/ARCHITECTURE.md` under the engine's file), so every Comb on the page is lost with it. A
`Response` the host application handed over is consumed when it is instantiated, so instantiating
anew needs the compiled `WebAssembly.Module` kept. The checks of the bridge keep host code and
unbounded copies out of the engine; a trap that slips past them, such as the one of
docs/plan/revision-2026-10-21/16-a-querys-mesh-has-a-budget.md, still wedges it.

After a trap, Comb either instantiates the engine anew from the module it was handed and loads
the graph its store holds, or refuses every later call with a typed error the host application
can act on, for example by creating a new Comb. The tests provoke the trap through a seam of
their own, an export of the bridge crate available in test mode only (as the bridge's
`detaching` is), so that they do not depend on a trap the checks may close, such as the one of
ticket 16.

## Acceptance criteria

- [ ] Given a Comb whose engine trapped during a call, when the host calls `load` with a valid
      graph, then the graph is drawn, or the call throws a typed error that names the trap, and
      no untyped error escapes (`Verifies: Q-7`).
- [ ] Given two Combs on one page, when the engine traps in a call of one, then the other one
      draws as before or reports the same typed error.
- [ ] Given a trap inside an animation frame, when the frame runs, then no page error escapes
      the frame, and the next frame draws or the host application is told; the channel it is
      told through is what the decision of this ticket settles, and this criterion is rewritten
      with it.
- [ ] Broken once: without the recovery, the first criterion's test fails with `recursive use of
      an object detected`.

## Read first

- `docs/SPECIFICATION.md` Q-7; ADR-0019 (the host hands Comb its engine), ADR-0010, ADR-0009
  (*Bridge*, *Shell*), ADR-0007 (protected parts).
- `docs/ARCHITECTURE.md` on the engine's file and its one instance per page;
  `packages/comb/wasm/engine.js` (`__wbg_init`, the cached instance).
- `packages/comb/src/bridge/index.ts` (`createBridge`, `wrap`, `detaching`),
  `packages/comb/src/api/index.ts` (`createComb`, `checked`), `packages/comb/src/api/engine.ts`,
  `packages/comb/src/api/frames.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: a new error the public interface throws after a trap, or an engine instantiated
anew behind it, changes the public interface and the bridge, protected parts of ADR-0007, and is
a decision of its own, recorded as an ADR first, in a pull request of ADRs only, with ADR-0019
revised where keeping the host's module changes what it says about the engine's file.
