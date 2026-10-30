# Ticket: A value shows its trend

## What to build

The `metric` element: a caption above a value, beside it a trend with a direction (up, down,
flat) drawn as an arrow, and a text, in the colour the host gives. Laid out by the engine as two
lines in its column; drawn at the near level. A load's `metric` fills the columns ADR-0034 gives
it, its caption, value, and trend's text among the texts and its trend's direction and colour
in the columns per element.

## Acceptance criteria

- [ ] Given a metric, when it is laid out, then the rectangles of its caption, value, and trend
      match the reference within 0.5 px and stay inside the column.
- [ ] Given a metric, when the node is drawn near, then inspection reports its caption, value,
      and an arrow of the given direction and colour; middle and far draw none.
- [ ] Given a direction other than up, down, or flat, or a malformed text or colour, then a typed
      problem names the node.
- [ ] Given a click on a metric, then `onContentClick` names kind `metric`.
- [ ] Given the type test of content, then it admits `metric`.

## Read first

- ADR-0013, ADR-0027.

## Blocked by

- docs/plan/node-content/02-an-element-click-reaches-the-host.md

## Mode

with the human: it changes the public interface (`packages/comb/src/api/`, `index.ts`), the
bridge crate's validation (`crates/engine-wasm/`), and the engine's graph
(`crates/engine/src/graph.rs`), protected parts of ADR-0007.
