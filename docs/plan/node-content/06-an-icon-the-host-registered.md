# Ticket: An icon the host registered

## What to build

`registerIcon(name, image)` takes an image object the host application has loaded (an
`ImageBitmap`, an `HTMLImageElement` that has loaded, or a canvas) and makes it a texture; the
`icon` element names it and is drawn as a square of the row's line height at the near level. An
icon named but not registered draws nothing and is no error; registered later, it appears. Comb
never fetches an image (Q-6).

## Acceptance criteria

- [ ] Given a registered icon, when a node names it, then inspection reports a sprite of that
      texture at the rectangle the engine laid out, within 0.5 px of the reference.
- [ ] Given an icon not yet registered, when the node is drawn, then it draws nothing; when the
      host then registers it, then it is drawn without a new load.
- [ ] Given `registerIcon` with a string, a URL, or an image that has not loaded, then it throws a
      typed error and fetches nothing.
- [ ] Given the CSP test of Q-6, when icons are registered and drawn, then it still passes.
- [ ] Given a click on an icon, then `onContentClick` names kind `icon`.
- [ ] Given the type test of content, then it admits all six kinds.

## Read first

- ADR-0013 (*No URLs in graph data*), ADR-0020 (no eval), ADR-0027; the Q-6 browser test.

## Blocked by

- docs/plan/node-content/02-an-element-click-reaches-the-host.md

## Mode

with the human: it changes the public interface (`packages/comb/src/api/`, `index.ts`), the
bridge crate's validation (`crates/engine-wasm/`), and the engine's graph
(`crates/engine/src/graph.rs`), protected parts of ADR-0007.
