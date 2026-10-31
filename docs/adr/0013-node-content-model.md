# ADR-0013: Node content is a closed set of elements in rows, laid out by the engine

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** the node-content types of `crates/engine` and `crates/engine-wasm`, their generated TypeScript definitions in `packages/comb`, the layout functions of the engine, the drawing of node content in `packages/comb/src/render/`, the report of a click on a content element in `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs` and its export in `crates/engine-wasm/`, the label extents the render layer of `packages/comb/src/render/` hands the engine, and the press and hover of `packages/comb/src/interaction/`

## Context

G-10 asks for the host application to describe what a node shows as content elements, for Comb
to draw them, and for a click on an element to reach the host application. G-9 names the
elements its example needs: a title, an icon with a kind, a hypothesis, a progress bar in
segments, a status badge, values over three periods with a coloured trend, and a "Details" link.
A node today is a title and a size the host application gives; nothing of it is reported but its
selection.
Q-1 asks for 60 fps with 50,000 nodes, Q-4 for geometry exact to 0.5 px, and Q-5 forbids
interpreting graph data as HTML, script, or URL.

A description Comb draws itself can be pooled and batched (ADR-0027); a callback in which the host
application draws with PixiJS cannot, and its cost is outside Comb's control. A closed set of
elements is a public interface the host application relies on, so adding an element is a change
of that interface.

Laying out the elements is geometry: the height of each row, the position of each element, the
truncation of text to its column. ADR-0028 puts geometry into the engine, where Q-4 can be tested
without a browser. Text widths depend on the font, which the shell knows from its `BitmapText`
fonts (ADR-0027).

## Decision

We will describe node content as rows of weighted columns, each holding one element of the closed
set `text`, `icon`, `progress`, `badge`, `metric`, and `action`, laid out by the engine from glyph
advances the shell hands it once per font, with icons named from images the host application
registers and colours given as numbers.

- **Elements:** `text` with a role of title, body, or caption; `icon` by registered name;
  `progress` as segments, each a fraction and a colour; `badge` as text on a colour; `metric` as a
  caption, a value, and a trend with a text, a direction, and a colour; `action` as text with an
  identifier, its fields `text` and `id`, laid out and drawn as a text in the font of role body,
  in a link colour. A `badge`, its fields `text` and `color`, is laid out in the font of role
  body on a pill as an edge label's: the pill lies at its column's left, as wide as its text is
  drawn and 8 world units either side, at most the column, and as high as the body's line and 3
  above and below, 22 with a line of 16; its text is cut to the column less the 16 of padding,
  and the pill's corners are rounded by half the smaller of its width and height, at most 11.
  The engine states the padding, and the shell places the text on the pill by it. In a row that
  holds a badge, every other element lies 3 lower, so that the texts of the row share one line,
  and the row is as high as its deepest element so placed; a row without a badge is laid out as
  before. A badge's cell is its pill, so that a press beside the pill in its column hits no
  element. Its text is drawn white or in the near-black of the node's texts, `0x1F2430`,
  whichever has the higher contrast ratio with the pill's colour by WCAG's relative luminance.
  A `progress`, its field `segments`, each a `fraction` and a `color`, shows no text: its cell is
  its column and the body's line, 16 high with a line of 16, laid out and hit as a text's cell,
  so that a press anywhere on that line in its column, above or below the bar too, hits it. Its
  bar is as wide as the column and 8 world units high, at most the line, in the middle of the
  line; the engine cuts it into its segments in order from the column's left, each as long as its
  fraction of the bar, and the track, the rest of the bar, so that no segment reaches past the
  column's end. The shell draws the segments in their colours and the track in `0xE5E7EB`, only
  the bar's two outer ends rounded by 4, at most half its height and half its length, the
  segments and the track abutting square. A progress bar holds at most 8 segments; a fraction is
  finite and not negative, a segment's colour is a badge's, and the fractions sum to at most 1
  and 1e-9 beyond it, so that fractions that sum to 1 in exact arithmetic are not refused for
  their rounding. A `metric`, its fields `caption`, `value`, and `trend`, the trend its `text`, its
  `direction`, `up`, `down`, or `flat`, and its `color`, a badge's, is laid out in two lines in its
  column, the caption's line in the font of role caption and below it, with no space between, the
  value's line in the body's: 30 high with lines of 14 and 16, its cell, and so what a press hits,
  the column and both lines. The caption fills its line, cut to the column as a text is. On the
  value's line the value lies at the column's left, as wide as it is drawn; the trend's arrow 8
  after it, the gap between columns; and the trend's text 4 after the arrow, to the column's end.
  The arrow fills a square 10 wide in the middle of the value's line, 3 below its top with a line
  of 16, and is one triangle turned by its direction, its base one side of the square and its
  apex the middle of the opposite side: ▲ its base below, ▼ above, ▶ at the left. Where the
  column is too narrow, the trend's text is cut first, to what the value, both gaps, and the arrow
  leave; where they leave none, the trend's text is cut to nothing and the value to the column
  less the gap before the arrow and the arrow, the gap shrinking where even that leaves no room,
  so that the arrow ends at the column's end; a column narrower than the arrow draws none. The
  engine places each part and the arrow's three points, and the shell draws the caption in the
  caption's colour, `0x6B7280`, the value in the near-black of the node's texts, `0x1F2430`, and
  the arrow and the trend's text in the trend's colour. A metric lies at its row's top as every
  element does, and in a row that holds a badge 3 lower, as every element but a badge does.
- **Content replaces the title and the height:** a node is its identifier, its position, its
  width, and its content; its title is a `text` of role title, and the engine computes its height.
  `updateNode` replaces a node's content as a whole, checked as a load checks it.
- **Clicks:** a click on any element, without a drag, is reported to the host application with
  the node's identifier, the element's row and column, and its kind, and for an `action` its
  identifier; it selects the node as a click on the node does. It reaches the host application
  through `Comb.onContentClick(listener)`, which returns the function that removes the listener,
  as `{ node, row, column, kind, action? }`. A press on a node waits for the slop of a press on an
  edge (ADR-0025), 4 screen pixels from the press: released within it, the press is a click; once
  the pointer has moved beyond it, the node is dragged from the press and no click is reported.
  The engine's hit test names the element whose rectangle holds the point, of those drawn at the
  level of detail: at *near* every element, at *middle* the texts of role title, at *far* none; a
  press on the padding or between elements selects the node and reports no click. An element is
  hit across the whole rectangle of its cell, not only where its glyphs are drawn. The element
  reported is the one under the release, asked anew, since the host application may change the
  node's content when it hears of the selection; a release off that node or off its elements, a
  release outside the canvas, and a cancelled pointer report none.
- **Layout:** the host application gives a node's width; the engine computes each row's height,
  each element's rectangle, and where each text is truncated, and the node's height from its rows.
  A row is as high as its tallest element, and a row's columns share its width by their weights,
  a weight left out counting as 1. A node is as high as its rows and the padding above and below
  them, and at least the least height, 64 world units, so that a node of one row of a title keeps
  the size of the nodes before content. The engine states the padding, the gap between columns,
  and the least height; the shell states each role's line height.
- **Levels of detail (ADR-0027):** *near* draws every element; *middle* draws the box and the
  texts of role title, at the place near gives them, and no action, badge, progress bar, or
  metric; *far* draws no element.
- **Limits (Q-7):** the bridge refuses a node with more rows, a row with more columns, a progress
  bar with more segments, a text longer, or a load whose texts hold more code units in all than
  limits it states, each with a typed problem that names the node.
- **Fonts:** the shell passes each `BitmapText` font's glyph advances and line height to the
  engine once, before the first layout that uses it.
- **No URLs in graph data:** an icon is named, never located; an `action` carries an identifier,
  never a link. The host application turns either into whatever it means. It registers an icon's
  image as an object it has already loaded, never as a URL Comb would fetch (Q-6).
- **Hit test:** this ADR takes over the clauses of ADR-0025 below and supersedes it on its
  acceptance. The engine answers every hit test from its spatial index, in one call that takes a
  world point, the size of a screen pixel, the level of detail, and whether to look for
  connectors, and returns the target drawn on top there: a connector, else an edge label, else a
  node, with the element of its content under the point, else an edge, else none.
  - **Connector:** within 8 screen pixels of its point, at the near and the middle level, the
    node and side it belongs to (ADR-0024). The shell asks for connectors only where a connection
    can begin, where `CombOptions.canConnect` is set (ADR-0023); otherwise the call hits none, and
    a press there finds what lies beneath.
  - **Edge label:** at the near level only, where labels are drawn, the label whose pill holds
    the point. The shell hands the engine the half width and half height of each label's pill, in
    world units, when it draws the label's text and whenever that text changes; a label the shell
    has not measured is not hit.
  - **Node:** inside its bounds, at every level, and of its content the element drawn there
    (*Clicks*).
  - **Edge:** within 4 screen pixels of its path as the stroke flattens it at the current zoom,
    at every level.
  - **On top:** within one kind, the item drawn last: the node of the highest rank (ADR-0022),
    and the edge or label in the highest slot.
  - **One call:** the result crosses as one generated structured value (ADR-0010) naming the kind
    and the slot, for a connector its side, and for a node the element hit. Interaction calls it
    on press, on hover, and on the release of a press on a node, and draws the cursor from it.
  - **What a press does:** on a connector it begins a connection; on an edge label it selects the
    label's edge and begins a drag of the label; on a node it selects the node, and once the
    pointer has moved more than 4 screen pixels from the press, begins a drag of it, a release
    before that being a click (*Clicks*); on an edge it selects the edge, and once the pointer has
    moved more than 4 screen pixels from the press, begins a pan from it, so that a canvas dense
    with edges still pans by dragging; on none it clears the selection and begins a pan.

**Out of scope:** elements beyond the six, each a revision of this ADR; a callback in which the
host application draws; styling beyond colours and roles, such as fonts per node; a selection of
more than one item; hitting an edge's arrowhead apart from its path.

## Alternatives considered

- **Render callbacks in which the host application draws with PixiJS** — the most flexible, but
  pooling, batching, and levels of detail leave Comb's control, and so does Q-1.
- **The six elements plus a `custom` callback element** — a way out for special cases, but one
  callback element in a node puts that node's cost outside every guarantee, and nothing keeps it
  rare.
- **Layout in TypeScript** — text measurement is at hand there, but the geometry of Q-4 would
  leave the functional core and need a browser to test.
- **Icons by URL** — familiar from HTML, but graph data that names a URL is what Q-5 forbids Comb
  to interpret.

## Sources / Prior art

- The reference picture the maintainer gave for G-9 (not in the repository).
- PixiJS v8, `BitmapText` and bitmap fonts —
  <https://pixijs.com/8.x/guides/components/scene-objects/text/bitmap>.

## Consequences

- Positive: every element is drawn by Comb, so pooling, batching, and levels of detail cover all
  of node content.
- Positive: layout is a pure function of the content, the width, and the font metrics, tested
  natively against Q-4.
- Negative / trade-offs: a host application that needs an element outside the six waits for a
  revision of this ADR.
- Negative / trade-offs: glyph advances cross the bridge once per font, and a font change means a
  new layout of every node that uses it.
- Negative / trade-offs: a node's height is no longer the host application's to give; a host that
  wants equal heights gives equal content.
- Follow-ups: kerning and right-to-left text, which glyph advances alone do not cover.

## Enforcement

A Rust test in `crates/engine/src/content.rs` lays out node content of every element kind at
several widths and asserts each rectangle against a reference within 0.5 px, that no element
extends past the node's width, and that a node is as high as its rows and padding, at least the
least height. A browser test clicks an element of each kind and asserts the report the host
application receives, and that a drag that starts on an element reports none. A browser test in
`examples/metric-tree/e2e/node-content.spec.ts` asserts what each level of detail draws of a
node's content. A test in `packages/comb/src/content-types.test.ts` asserts that the generated
TypeScript type of node content admits exactly the element kinds built, each kind's ticket adding
its own until it admits the six. Each cites this ADR with `Verifies:
ADR-0013`, and the first also `Verifies: Q-4`.

The tests of the hit test verify its clauses here too; they cite `Verifies: ADR-0025` until this
ADR supersedes it:

- **Against a scan:** a test of `crates/engine/src/graph.rs` hits random points of random graphs
  with labels and connectors, at each level, and asserts the target a brute-force scan finds in
  the order of the decision, the distance to an edge measured to its flattened path.
- **Precedence:** browser tests in `examples/metric-tree/e2e/` press on a label above a node, on
  a connector on a node, on a node above an edge, on an edge, and on the empty canvas, and assert
  what is selected or dragged; they also `Verifies: G-5, G-6`.
- **Connectors asked for:** a browser test asserts that a press on a connector without
  `canConnect` begins no connection, and one asks `hitKind` beside a connector with and without
  connectors and asserts a connector only where they are asked for.
- **Unmeasured labels:** a test asserts that a label without extents is not hit, and one with
  them is hit inside its pill and not beyond it.
- **The slop of a press:** `packages/comb/src/interaction/interaction.test.ts` asserts that a
  press on an edge pans and a press on a node drags only beyond 4 screen pixels, and
  `examples/metric-tree/e2e/content-click.spec.ts` that a release within them clicks.
