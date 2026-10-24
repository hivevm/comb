# Ticket: A badge shows a status

## What to build

The `badge` element: a text on a rounded pill of the colour the host gives, laid out by the engine
like a text whose rectangle includes the pill's padding, drawn at the near level from pooled,
batched views.

## Acceptance criteria

- [ ] Given a badge in a column, when the engine lays it out, then its pill's rectangle matches the
      reference within 0.5 px and stays inside the column, its text truncated where it does not fit.
- [ ] Given a badge, when the node is drawn near, then inspection reports a pill of the given
      colour with its text; middle and far draw none.
- [ ] Given a click on a badge, then `onContentClick` names kind `badge`.
- [ ] Given a badge whose colour is no integer in 0 to 0xffffff, or whose text is malformed, then a
      typed problem names the node.
- [ ] Given the type test of content, then it admits `badge`.

## Read first

- ADR-0013, ADR-0027 (pools), and how edge labels draw their pills in the render layer, which a
  badge's pill copies.

## Blocked by

- docs/plan/node-content/02-an-element-click-reaches-the-host.md

## Mode

with the human: it changes the public interface (`packages/comb/src/api/`, `index.ts`), the
bridge crate's validation (`crates/engine-wasm/`), and the engine's graph
(`crates/engine/src/graph.rs`), protected parts of ADR-0007.
