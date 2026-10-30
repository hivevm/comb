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
A load's content crosses the bridge as the columns of `text` ADR-0034 decides: the boundaries of
each node's rows and each row's elements, the kinds, the weights, the roles, and the texts in
pieces with their validity bytes, and the position of a shape the snapshot cannot flatten; the
title and height columns leave the load.

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
- [ ] Given a load whose nodes hold rows of several texts, strings outside the Basic Multilingual
      Plane among them, when `bridge.test.ts` cuts its content columns, then the boundaries, the
      kinds, the weights, the roles, and the texts are read back exactly per node, row, and
      element (`Verifies: ADR-0034`).
- [ ] Given content past each limit, an unknown kind, a weight that is not a positive finite
      number, an unknown role, and a text that is missing, of another type, or holds a lone
      surrogate, when `graph_data.rs` loads it as columns, then each is refused with its own
      problem kind naming the node, row, and column, at and past each bound, and content columns
      that do not fit together are refused as malformed (`Verifies: ADR-0034`).
- [ ] Given a row that is no list or an element that is no object, when the snapshot flattens the
      load, then it hands over the node, row, and column of the first such value, the bridge crate
      refuses it as `invalidContentShape` naming them, and a position that names no row or column
      is refused as malformed (`Verifies: ADR-0034`).
- [ ] Given the type test in `snapshot-only.test.ts`, when it is checked, then it pins the content
      columns among the parameter types of `loadGraph`, and no title or height column.
- [ ] Given `metricTree(3334)`, when the load is timed against `main`, then no step's median is
      above main's by more than 1 ms.
- [ ] Given any content the bridge accepts, when a property test lays it out, then every rectangle
      is finite and inside the node.
- [ ] Given the generated TypeScript type of content, when it is checked, then it admits `text`
      alone for now, and the test that asserts the set of kinds is in place to grow.

## Read first

- ADR-0013 (the model), ADR-0027 (levels of detail, `BitmapText`, pools), ADR-0025 (hit test),
  ADR-0028 (where validation lives), ADR-0034 (typed-array views, and the content columns of a
  load), ADR-0029 (the store), ADR-0030 (`nodeUpdated`).
- `docs/GLOSSARY.md`: node content, content element, level of detail.
- `docs/ARCHITECTURE.md`, the golden path of a load and of a query; the geometry tests of
  `crates/engine` as the pattern of the layout's reference test; `levels-of-detail.spec.ts` and
  `hostile-text.spec.ts` as the pattern of the browser tests.

## Blocked by

- None (can start immediately)

## Mode

with the human: it implements ADR-0034 and ADR-0013 while they are proposed, and it changes the
public interface (`packages/comb/src/api/`, `index.ts`), the bridge crate's validation
(`crates/engine-wasm/`), and the engine's graph (`crates/engine/src/graph.rs`), protected parts of
ADR-0007.
