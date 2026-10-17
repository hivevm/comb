# ADR-0013: Node content is a closed set of elements in rows, laid out by the engine

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** the node-content types of `crates/engine` and `crates/engine-wasm`, their generated TypeScript definitions in `packages/comb`, the layout functions of the engine, and the drawing of node content in `packages/comb/src/render/`

## Context

G-10 asks for the host application to describe what a node shows as content elements, for Comb
to draw them, and for a click on an element to reach the host application. G-9 names the
elements its example needs: a title, an icon with a kind, a hypothesis, a progress bar in
segments, a status badge, values over three periods with a coloured trend, and a "Details" link.
Q-1 asks for 60 fps with 50,000 nodes, Q-4 for geometry exact to 0.5 px, and Q-5 forbids
interpreting graph data as HTML, script, or URL.

A description Comb draws itself can be pooled and batched (ADR-0012); a callback in which the host
application draws with PixiJS cannot, and its cost is outside Comb's control. A closed set of
elements is a public interface the host application relies on, so adding an element is a change
of that interface.

Laying out the elements is geometry: the height of each row, the position of each element, the
truncation of text to its column. ADR-0009 puts geometry into the engine, where Q-4 can be tested
without a browser. Text widths depend on the font, which the shell knows from its `BitmapText`
fonts (ADR-0012).

## Decision

We will describe node content as rows of weighted columns, each holding one element of the closed
set `text`, `icon`, `progress`, `badge`, `metric`, and `action`, laid out by the engine from glyph
advances the shell hands it once per font, with icons named from images the host application
registers and colours given as numbers.

- **Elements:** `text` with a role of title, body, or caption; `icon` by registered name;
  `progress` as segments, each a fraction and a colour; `badge` as text on a colour; `metric` as a
  caption, a value, and a trend with a direction and a colour; `action` as text whose click Comb
  reports to the host application with the action's identifier and the node's.
- **Layout:** the host application gives a node's width; the engine computes each row's height,
  each element's rectangle, and where each text is truncated, and the node's height from its rows.
- **Fonts:** the shell passes each `BitmapText` font's glyph advances and line height to the
  engine once, before the first layout that uses it.
- **No URLs in graph data:** an icon is named, never located; an `action` carries an identifier,
  never a link. The host application turns either into whatever it means.

**Out of scope:** elements beyond the six, each a revision of this ADR; a callback in which the
host application draws; styling beyond colours and roles, such as fonts per node.

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
- Follow-ups: how the levels of detail of ADR-0012 reduce each element; kerning and right-to-left
  text, which glyph advances alone do not cover.

## Enforcement

A Rust test in `crates/engine` lays out node content of every element kind at several widths and
asserts each rectangle against a reference within 0.5 px, and that no element extends past the
node's width. A test in `packages/comb` clicks an `action` element and asserts the event the host
application receives. A test asserts that the generated TypeScript type of node content admits
exactly the six element kinds. Each cites this ADR with `Verifies: ADR-0013`, and the first also
`Verifies: Q-4`.
