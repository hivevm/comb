# ADR-0020: Comb installs PixiJS's code generation without eval before it creates a renderer

- **Status:** 🟢 accepted
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** `createComb` in `packages/comb/src/api/`, how `packages/comb` imports `pixi.js`, and every host application that embeds Comb

## Context

Q-6 asks Comb to work under a Content Security Policy that allows `wasm-unsafe-eval` but not
`unsafe-eval`. PixiJS 8 does not, by default. Before it creates a renderer it probes for
`unsafe-eval` with `new Function` and throws when the probe fails, naming the module
`pixi.js/unsafe-eval`. It also generates code with `new Function` to sync shader uniforms,
uniform buffers, and the particle container. Under the policy of Q-6 Comb draws nothing.

PixiJS ships the remedy in its own package. Despite its name, `pixi.js/unsafe-eval` is the module
*for* environments without `unsafe-eval`. Importing it replaces the four code generators with
implementations that use no eval, and turns the probe off. It is a side-effect import that
patches the prototypes of the PixiJS classes, so it holds for every PixiJS renderer on the page,
not only Comb's.

Measured on the GitHub runner, Benchmark runs 39545407940 (without the module) and 39545410268
(with it) ran at the same time on runners whose reference matched the baseline (×0.99 and ×1.00).
Their medians agree: first frame 377 and 371 ms, and p95 drag 250, pan 233, zoom 200, pan near
133, and pan middle 167 ms in both. Runs on runners of another kind scattered more than the module
could explain. Local runs on a loaded machine were inconclusive either way.

## Decision

We will import `pixi.js/unsafe-eval` in Comb's library, in the module that creates the renderer,
so that every `createComb` draws under a policy without `unsafe-eval` and Comb never asks the host
application to import it.

- **Place:** the import stands in `packages/comb/src/api/`, before any PixiJS renderer is created,
  and nowhere else.
- **Host applications:** the patch applies to every PixiJS renderer on the page. The README says
  so, for a host that draws with PixiJS itself.
- **Version:** the module comes with the `pixi.js` the host application bundles. A PixiJS
  upgrade that renames or drops it breaks the build, not a page at run time.

**Out of scope:** WebGPU, whose code generation the module also replaces but which Comb does not
use (ADR-0018); a policy stricter than Q-6's.

## Alternatives considered

- **Leave it to the host application** — the host imports `pixi.js/unsafe-eval` when its policy
  forbids `unsafe-eval`. Comb would draw faster where eval is allowed, if it were faster, but Q-6
  would hold only for hosts that read the README. Q-6 would have to change.
- **An option of `createComb`** — the same as the above with a switch. A dynamic import of the
  module would also arrive too late for a host that created a PixiJS renderer of its own first.
- **Allow `unsafe-eval` in Q-6** — a change to the specification. It weakens every host's policy
  for one library's convenience.

## Sources / Prior art

- PixiJS 8.22.0, `pixi.js/unsafe-eval` (`lib/unsafe-eval/init.mjs`): overrides
  `AbstractRenderer._unsafeEvalCheck` and `UboSystem._systemCheck`, and replaces
  `_generateUniformsSync`, `_generateUboSync` (GL and GPU), `_generateShaderSync`, and the
  particle buffer's update generator with implementations without eval.
- PixiJS 8.22.0, `AbstractRenderer._unsafeEvalCheck`: throws "Current environment does not allow
  unsafe-eval, please use pixi.js/unsafe-eval module to enable support."
- Measured: under `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'` the example fires a
  `securitypolicyviolation` for `eval` and draws nothing; with the import it draws and fires none.
- Benchmark runs 39545407940 and 39545410268, as above.

## Consequences

- Positive: Q-6 holds for every host application, with no step of its own.
- Negative / trade-offs: the patch reaches every PixiJS renderer on the host's page.
- Negative / trade-offs: the code without eval may sync uniforms more slowly. The runner showed
  no difference, but Q-1 is decided on the reference machine.
- Follow-ups: the measurement on the reference machine, which the design revision's ticket on
  Q-1 and Q-2 takes, shows whether the module costs frames there.

## Enforcement

A browser test serves the example under the policy of Q-6, records every
`securitypolicyviolation`, and asserts that none fires while the graph loads, is panned, and is
zoomed. It cites this ADR with `Verifies: ADR-0020`. A Bun test asserts that the module that
creates the renderer imports `pixi.js/unsafe-eval` before it imports `pixi.js`.
