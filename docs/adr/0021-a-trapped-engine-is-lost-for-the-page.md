# ADR-0021: A trapped engine is lost for the page; Comb refuses every later call with a typed error and tells the host application

- **Status:** 🟢 accepted
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** `packages/comb/src/bridge/`, `createComb` and the `Comb` interface in `packages/comb/src/api/`, the error types `comb` exports, and the render's animation frame

## Context

When WebAssembly traps inside a call of the engine (`unreachable` when memory runs out, an
out-of-bounds access), the `Engine` object stays borrowed, and every later call fails with the
untyped `Error: recursive use of an object detected which would lead to unsafe aliasing in rust`:
`load`, `updateNode`, and every render. The page keeps a canvas that no longer draws, a trap in
the animation frame escapes as a page error, and no typed error tells the host application why.
Q-7 asks that accepted graph data never crash the page and that malformed data be refused with a
typed error.

The engine is instantiated once per page: the glue wasm-bindgen generates caches its instance
(`__wbg_init` in `packages/comb/wasm/engine.js`), so every Comb on the page shares it, and a
`createComb` after the trap would get the same instance back. After a trap the instance's memory
may be inconsistent, an allocator stopped halfway, so no call into it is safe again. The checks of
the bridge (ADR-0009) and the mesh budget (ADR-0012) close the traps that are known; this decision
is for one that slips past them.

## Decision

We will treat a trap as the loss of the engine for the page: from the first trap on, every call of
every Comb on the page that needs the engine throws an `EngineLostError`, no trap escapes as a page
error, and the host application learns of the loss through a listener it registers.

- **Detection:** the bridge recognises a trap as a `WebAssembly.RuntimeError` thrown from a call
  of the engine, or the error the glue throws for an object still borrowed, and marks the engine
  lost for the page. Errors the bridge returns as values (ADR-0010) are not traps.
- **Refusal:** `load`, `updateNode`, `setViewport`, `fitView`, and a `createComb` after the loss
  throw `EngineLostError`, which `comb` exports beside its other errors and which names itself.
  Calls that do not touch the engine (`viewport`, `onSelectionChange`, `destroy`) keep working.
- **The frame:** the render's animation frame catches a trap, marks the engine lost, stops
  rendering, and resolves `whenRendered`; the canvas keeps its last frame.
- **The listener:** `Comb.onEngineLost(listener)` registers a function called once when the
  engine is lost, with the `EngineLostError`, and returns a function that removes it, like
  `onSelectionChange`. A listener registered after the loss is called at once.
- **Recovery:** none inside the page. The host application recovers by loading the page anew; the
  README says so.
- **Tests:** a seam available in test mode only, an export of the bridge crate that traps on
  demand, provokes the trap, so the tests do not depend on a trap the checks may close.

**Out of scope:** instantiating the engine anew within the page, which needs a way past the glue's
cached instance and the compiled module kept (ADR-0019); persisting the graph across the reload.

## Alternatives considered

- **Instantiate anew automatically** — Comb keeps the compiled `WebAssembly.Module`, builds a
  fresh instance after a trap, and loads the graph its store holds. The host sees nothing, but the
  glue caches one instance per page, so this needs a glue built or patched for it, and ADR-0019's
  handover of a `Response` would become one of a module.
- **Refuse, but allow a new Comb** — as decided, and `createComb` may build a fresh instance. It
  needs the same way past the cache as instantiating anew, for a smaller gain.
- **Leave it untyped** — the state today: a canvas that no longer draws, a page error in the
  frame, and an error the host application cannot tell from a bug of its own.

## Sources / Prior art

- wasm-bindgen's generated glue, `__wbg_init` in `packages/comb/wasm/engine.js`: it returns the
  cached instance when one exists.
- WebAssembly JavaScript interface, `WebAssembly.RuntimeError`: the error a trap throws —
  <https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/RuntimeError>.
- Measured: after a trap, the next call of the same `Engine` throws "recursive use of an object
  detected which would lead to unsafe aliasing in rust" (the reproduction of the mesh budget's
  ticket, before the budget).

## Consequences

- Positive: a trap never escapes as a page error, and the host application can tell its user why
  the canvas stopped, and offer a reload.
- Positive: small; no second instance, no change of how the host hands over the engine.
- Negative / trade-offs: one trap ends every Comb on the page until it is loaded anew.
- Negative / trade-offs: the public interface grows by an error and a listener.
- Follow-ups: whether the engine is instantiated anew within the page, should traps prove to occur.

## Enforcement

A Bun test of the bridge provokes the trap through the test-mode seam and asserts that the next
call throws `EngineLostError`. Browser tests provoke it in a call of `load` and inside the
animation frame, and assert that no page error occurs, that every later `load`, `updateNode`, and
`createComb` throws `EngineLostError`, that a second Comb on the page reports the same, that the
listener is called once, also when registered after the loss, and that `viewport` and `destroy`
still work; without the recovery the first of them fails with "recursive use of an object
detected". The test of every exported error naming itself covers `EngineLostError`. Each cites
this ADR with `Verifies: ADR-0021`, and the browser tests also `Verifies: Q-7`.
