# ADR-0018: Comb draws with WebGL2, and on Canvas 2D only where the host application opts in

- **Status:** 🟢 accepted
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** `createComb` and `CombOptions` in `packages/comb/src/api/`, the error types `comb` exports, and the edges layer in `packages/comb/src/render/`

## Context

The specification asks for a PixiJS scene graph on WebGL2
([Constraints](../SPECIFICATION.md#constraints)), and Q-1 is measured there. Where a browser
offers no WebGL2, PixiJS falls back to its Canvas 2D renderer without a word. That renderer cannot
run the edge mesh's shader (ADR-0012), so a canvas drawn that way shows nodes without edges, and a
slow one. A test environment without WebGL2 runs on that fallback unnoticed unless something
refuses it.

Some host applications would rather show a graph without dash patterns, slowly, than show
nothing: a kiosk without a GPU, a locked-down virtual desktop. Others would rather fail loudly.
The host application knows which it is; Comb does not.

## Decision

We will refuse to draw where PixiJS finds no WebGL2, by throwing a `RendererUnavailableError`
from `createComb` that names the renderer PixiJS offered, unless the host application sets
`CombOptions.allowCanvasFallback`, in which case Comb draws with PixiJS's Canvas 2D renderer.

- **Default:** refusal. A host application that sets nothing gets WebGL2 or an error, never a
  canvas that silently draws less.
- **Fallback:** with `allowCanvasFallback: true`, the edges layer fills the triangles of the
  engine's edge mesh into one `Graphics` of the layer, not one per edge; dash patterns are drawn
  solid, because the gaps are left out by the WebGL2 shader alone. Everything else draws as on
  WebGL2. Q-1 is not promised there.
- **Inspection:** `comb/testing`'s `inspect()` names the renderer, so a test or the benchmark can
  tell the fallback from WebGL2.

**Out of scope:** WebGPU, which PixiJS offers too and which a later decision may take up; any
fallback below Canvas 2D.

## Alternatives considered

- **Refusal without an option** — the simplest contract, and it kept the tests honest; but it
  leaves a host application without a GPU no way to show anything.
- **Silent fallback** — PixiJS's own default; it draws nodes without edges and hides a broken
  environment.
- **Fallback by default, refusal on request** — friendlier to the first try, but a host
  application that never reads the option ships a canvas that draws less without knowing it.

## Sources / Prior art

- PixiJS v8, `autoDetectRenderer` and the `preference` option of `Application.init`: the
  renderer falls back from WebGL to Canvas 2D where WebGL is missing —
  <https://pixijs.com/8.x/guides/components/renderers>.
- Headless Chromium in a Dev Container with forwarded Wayland or X11 displays starts no GPU
  process and offers no WebGL2, so PixiJS draws there with Canvas 2D.

## Consequences

- Positive: the default stays loud; a broken environment shows as an error, not as a canvas
  without edges.
- Positive: a host application without a GPU can still show its graph, knowingly.
- Negative / trade-offs: a second drawing path for the edges, used only on the fallback, which
  the browser tests must cover or it rots.
- Negative / trade-offs: dash patterns are lost on the fallback.
- Follow-ups: whether WebGPU becomes a third renderer.

## Enforcement

A browser test refuses every WebGL context and asserts that `createComb` throws a
`RendererUnavailableError` and adds no canvas; a second, with `allowCanvasFallback`, asserts that
the canvas draws, that `inspect()` names the Canvas 2D renderer, and that the edges layer drew
triangles. Each cites this ADR with `Verifies: ADR-0018`.
