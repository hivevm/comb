# Ticket: A badge shows a status

## What to build

The `badge` element: a text on a rounded pill of the colour the host gives, laid out by the engine
like a text whose rectangle includes the pill's padding, drawn at the near level from pooled,
batched views. A load's `badge` fills the columns ADR-0034 gives it, its text among the texts and
its colour in the column of colours per element, with that column itself and the kind's code.

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

## Where it stands

Stopped before any code, on a question the ticket, ADR-0013, and ADR-0034 leave open: **how wide
a badge's pill is, and with it what a press on a badge hits.**

- A text's rectangle is its whole column (`content::lay_out`), and ADR-0013 hits "an element
  across the whole rectangle of its cell". The ticket lays a badge out "like a text whose rectangle
  includes the pill's padding", and its first criterion asks for the pill's rectangle "within
  0.5 px of the reference" and "inside the column". An edge label's pill, which the badge copies,
  hugs its text (`render/labels.ts`). The placed rectangle per element is one rectangle
  (ADR-0034, *Streams*), and it serves both the drawing and `element_at`.
- The choices, each a decision for the human:
  1. **The pill fills its column:** the placed rectangle is the column, as wide as a text's, and
     as high as the pill; the pill is drawn across it, and a press anywhere on it hits the badge.
     This is the simplest choice, and the cell's hit clause stands as written. A badge in a wide
     column reads as a bar, not a chip, and the host narrows it only by weights.
  2. **The pill hugs its text, and the pill is the badge's rectangle:** the engine places the
     pill at the column's left, the drawn text's advance plus the padding wide, at most the
     column; the engine decides the pill exactly (Q-4), and a press beside the pill in its column
     hits no element, as a press on an edge label hits only its pill. This needs an ADR-0013
     amendment: a badge's cell is its pill.
  3. **The pill hugs its text, and the column stays the hit:** the placed rectangle is the column
     (hit and layout), and the shell draws the pill from its measured text, as a label's pill is
     drawn. The engine's test then decides only the column. The pill's width is a shell
     measurement that criterion 1's 0.5 px does not reach.
  - Recommendation: 2. It looks like the label pill the ticket says to copy, the engine computes
    all of the pill's geometry, and it hits the way an edge label hits.
- Taken from the edge label's pill, the reference the ticket names, unless the human says
  otherwise: the badge's text is laid out and drawn in the font of role body (the label's 12 px
  Arial), in white; the pill is 22 high, the body's line of 16 plus 3 above and below, with 8
  either side of the text and a corner radius of half its height, 11. A row holding a badge is
  22 high. The text is cut to the column less the 16 of padding.
- Not open: at the middle and the far level a badge is neither drawn nor hit (ADR-0013, *Levels of
  detail*, and the hit clause), and the layout does not depend on the level. "The reference" of
  criterion 1 is the hand-worked rectangles of `crates/engine/src/content.rs`'s tests, as for
  texts and actions. The colour column per element and `invalidContentColor` are given by
  ADR-0034.
- Where the code goes, once the width is decided: `Element::Badge { text }` in
  `crates/engine/src/content.rs` (role body, height `line + 2 × 3`, cut to `column − 16`, and
  under choice 2 a width of the cut text's advance plus 16); `KindCode::Badge`, the colour column
  and its check in `crates/engine-wasm/src/graph_data/content.rs` and `graph_data.rs`;
  `ElementKind::Badge` in the hit; `KINDS`/`kindCode` and the colour column in
  `packages/comb/src/bridge/index.ts` and `api/snapshot.ts`; a pooled `Graphics` pill per badge in
  `render/nodes.ts`, reported by inspection with its colour; the browser click spec in
  `examples/metric-tree/e2e/content-click.spec.ts`; and `content-types.test.ts` extended by
  `badge`.
