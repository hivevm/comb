# Ticket: A node shows its content as rows of text

## What to build

The tracer bullet through the whole path. A node is its identifier, position, width, and
`content`: rows of weighted columns, each a `text` of role title, body, or caption. `title` and
`height` leave `NodeData`. The shell hands the engine the glyph advances and line height of each
`BitmapText` font once; the engine lays the rows out, truncates each text to its column with an
ellipsis, computes the node's height, and uses that size for the spatial index, culling, the
connectors, the edge ends, and the hit test. The near level draws every text, the middle level the
texts of role title, the far level the particles sized by the derived height. `updateNode` replaces
`content` whole and `nodeUpdated` carries it. The bridge refuses malformed content and states the
limits: rows per node, columns per row, code units per text, and code units of all texts in a load.

Every test, the example, and the benchmark's graph move to content in this ticket: a node of
today becomes one row holding one text of role title.

## Acceptance criteria

- [ ] Given a node of one row with a title text, when the graph loads, then inspection reports
      one text view at the place today's title is drawn, and every existing browser test passes
      on graphs so described.
- [ ] Given rows of title, body, and caption texts in weighted columns, when the engine lays them
      out at several widths, then each rectangle matches an independent reference within 0.5 px,
      no rectangle extends past the node's width, and the node's height is the sum of its rows'
      (`Verifies: ADR-0013`, `Verifies: Q-4`).
- [ ] Given a text wider than its column, when it is drawn, then it is truncated with an ellipsis
      within the column.
- [ ] Given two nodes of different content, when the graph loads, then each has the height of its
      rows, and the hit test, the connectors, and the edge ends follow that height.
- [ ] Given the middle level, when the viewport zooms out past 0.6, then only the texts of role
      title are drawn; given the far level, no text is drawn.
- [ ] Given `updateNode` with new content, when it is applied, then the canvas shows it, the
      node's height follows, and `nodeUpdated` carries the content.
- [ ] Given content past any limit, or malformed (a row that is no array, an unknown kind, a
      weight that is not a positive finite number, a text that is no string), when it is loaded or
      patched, then a typed problem names the node and the graph stays as it was (Q-7).
- [ ] Given any content the bridge accepts, when a property test lays it out, then every rectangle
      is finite and inside the node.
- [ ] Given the generated TypeScript type of content, when it is checked, then it admits `text`
      alone for now, and the test that asserts the set of kinds is in place to grow.

## Read first

- ADR-0013 (the model), ADR-0027 (levels of detail, `BitmapText`, pools), ADR-0025 (hit test),
  ADR-0028 (where validation lives), ADR-0010 (typed-array views), ADR-0011 (the store), ADR-0023
  (`nodeUpdated`).
- `docs/GLOSSARY.md`: node content, content element, level of detail.
- `docs/ARCHITECTURE.md`, the golden path of a load and of a query; the geometry tests of
  `crates/engine` as the pattern of the layout's reference test; `levels-of-detail.spec.ts` and
  `hostile-text.spec.ts` as the pattern of the browser tests.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the public interface (`packages/comb/src/api/`, `index.ts`), the
bridge crate's validation (`crates/engine-wasm/`), and the engine's graph
(`crates/engine/src/graph.rs`), protected parts of ADR-0007.
