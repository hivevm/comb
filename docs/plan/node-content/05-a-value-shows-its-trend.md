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

## Where it stands

Stopped before any code. Already decided by the human: a metric is two lines in its column, the
caption in the caption role's font, below it the value in the body's font at the left, then a
trend arrow 10 wide and the trend's text right of it; arrow and trend text in the host's colour,
caption and value not; narrow, the trend text is cut first, then the value; the cell, and so the
hit, is the whole two-line rectangle; ▲ ▼ ▶ as equal filled triangles from the engine; middle and
far draw and hit no metric; inspection reads the drawing; the problems of ADR-0034. Open, each a
number or a rule of layout that ADR-0013 must state and the engine's reference test pins (Q-4):

1. **The gaps on the value's line**, between the value and the arrow and between the arrow and
   the trend's text.
   - a. 8 and 4: the gap between columns (`COLUMN_GAP`) before the arrow, so that the value reads
     apart from its trend, and half of it after, so that arrow and text read as one.
   - b. 4 and 4: tighter, one new constant.
   - c. 8 and 8: `COLUMN_GAP` twice, no new constant.
   - Recommendation: a.
2. **The arrow's height and place.** Each triangle in a square 10 by 10, ▲ with its base at the
   bottom, ▼ at the top, ▶ at the left, its apex in the middle of the opposite side, so that the
   three are one triangle turned; the square in the middle of the value's line (3 from its top
   with a body line of 16). Alternative: 10 wide and 8 high (`BAR_HEIGHT`), which makes ▶ 8 wide
   and so unequal to the others. Recommendation: the square.
3. **The space between the two lines:** none, the value's line directly below the caption's,
   since each line height already holds its leading; the metric 14 + 16 = 30 high with the shell's
   lines. Alternative: a gap of 2 to 4. Recommendation: none.
4. **The rectangles of the value and the trend's text, and a column too narrow for the arrow.**
   The value's rectangle as wide as it is drawn (as a badge's pill hugs its text), so that the
   arrow follows it; the trend's text from its left to the column's end, as a text's rectangle
   is its column; the caption's rectangle its column's width and its line. The trend's text is cut
   to what the column leaves after the value, the gaps, and the arrow; once it is cut to nothing,
   the value is cut to the column less the first gap and the arrow; a column narrower than the
   arrow draws no arrow, so that nothing passes the column. Recommendation: as stated.
5. **Other elements in a row that holds a metric.** a. At the row's top, as every element lies
   today, a text beside a metric sharing the caption's top; the row 30 high. b. On the value's
   line (14 lower). Recommendation: a: no new rule; three metrics side by side, G-9's values over
   three periods, align either way.
6. **A metric beside a badge.** a. The existing rule (ADR-0013: every element other than a badge
   lies 3 lower in a row that holds one): the metric's caption shares the badge text's line, the
   row 33 high. b. An exception that leaves the metric at the row's top. Recommendation: a, which
   needs no code beyond the rule as it stands.
7. **The caption's colour.** "Caption and value in the normal text colour": a. each in its role's
   colour, the caption grey (`0x6B7280`) as every caption is drawn, the value near-black
   (`0x1F2430`); b. both near-black. Recommendation: a.

Not open, taken unless the human says otherwise: the streams of ADR-0034 grow by what a metric
needs, as the bar's pieces did for ticket 04, recorded in ADR-0034: per placed element the
boundaries of its drawn texts, three for a metric and one for a text, an action, or a badge, each
drawn text with its rectangle, its role, and its colour; and per placed element the arrow as a
polygon of three points in world units relative to its node, with its colour, so that the engine
alone holds the arrow's geometry. The hit stays the cell (`content::element_at`), `ElementKind`
gains `Metric`. Where the code goes: `Element::Metric { caption, value, trend }` and its layout in
`crates/engine/src/content.rs`; `KindCode::Metric`, the direction and colour columns and
`invalidDirection` in `crates/engine-wasm/src/graph_data/content.rs`, `graph_data.rs`, and the
property tests; the streams in `crates/engine-wasm/src/lib.rs` and
`packages/comb/src/bridge/index.ts`; the snapshot's fields in `packages/comb/src/api/snapshot.ts`
and its read-count test; a pooled `Graphics` of arrows in `packages/comb/src/render/nodes.ts`;
the browser specs `node-content.spec.ts`, `content-click.spec.ts`, and `malformed.spec.ts`; and
`content-types.test.ts` extended by `metric`, with the unknown-kind examples naming `metric`
moved to `icon`.
