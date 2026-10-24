# Ticket: A progress bar shows how far it has come

## What to build

The `progress` element: a bar the width of its column, divided into segments, each a fraction
and a colour, drawn at the near level. Fractions that sum past 1 are refused; the rest of the bar
is drawn in the track colour.

## Acceptance criteria

- [ ] Given a progress bar of segments 0.3 green and 0.2 grey, when it is laid out, then each
      segment's rectangle matches the reference within 0.5 px, in order, from the column's left.
- [ ] Given a bar, when the node is drawn near, then inspection reports its segments and track;
      middle and far draw none.
- [ ] Given fractions that are negative, not finite, or sum past 1, or more segments than the
      limit, then a typed problem names the node.
- [ ] Given a click on a bar, then `onContentClick` names kind `progress`.
- [ ] Given the type test of content, then it admits `progress`.

## Read first

- ADR-0013, ADR-0027.

## Blocked by

- docs/plan/node-content/02-an-element-click-reaches-the-host.md

## Mode

with the human: it changes the public interface (`packages/comb/src/api/`, `index.ts`), the
bridge crate's validation (`crates/engine-wasm/`), and the engine's graph
(`crates/engine/src/graph.rs`), protected parts of ADR-0007.
