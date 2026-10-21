# Ticket: The engine says what its query writes, and keeps a level's stroke beside its widths

## What to build

The query no longer writes the control points of the edges it found: `drawnEdges` computes the
ends of those edges when inspection asks. Three texts in the engine still describe the old
query:

- the module comment of `crates/engine/src/graph.rs` says the query "writes the control points
  of the edges it found";
- the doc comment of `edgeEndsLen` in `crates/engine-wasm/src/lib.rs` speaks of "the four
  control points of each edge the last query found", where the buffer holds two ends per edge
  that `drawnEdges` wrote;
- the test `a_query_returns_the_control_points_and_label_points_of_what_it_found` in `graph.rs`
  asserts ends.

The stroke of a level of detail is spread over two files. `graph.rs` holds `FLATNESS`,
`FAR_EDGE_WIDTH`, and `Level::stroke`, which builds the far stroke field by field. `stroke.rs`
holds `STROKE_WIDTH`, `Stroke`, and `Stroke::full`. `STROKE_WIDTH` is `pub(crate)` only so that
a test in `graph.rs` can read it. `Level::stroke` and the widths move into `stroke.rs`, beside
`Stroke`, and the texts say what the code does. No behaviour changes.

## Acceptance criteria

- [ ] Given `graph.rs` and `lib.rs`, when their comments and test names are read, then none says
      that a query writes control points, and the comment of each buffer says who writes it and
      what it holds.
- [ ] Given `stroke.rs`, when it is read, then it holds the stroke of every level, the
      flatness and the far width in screen pixels and the full width in world units among
      them, each with its unit named, and `graph.rs` asks it for the stroke of a level.
- [ ] Given the move, when `cargo test` and the mutation list are compared before and after, then
      the same tests pass and `crates/engine/mutants-missed.txt` stays as it is.

## Read first

- ADR-0010 (*Streams*), ADR-0012 (*Edges*, *Levels of detail*), ADR-0008 (*Mutation testing*).
- `crates/engine/src/graph.rs` (`Level`, `query`), `crates/engine/src/stroke.rs` (`Stroke`),
  `crates/engine-wasm/src/lib.rs` (`drawn_edges`, `edge_ends_len`),
  `crates/engine/mutants-missed.txt`.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the engine's suite passes unchanged in what it asserts;
- scope: comments, one test name, and a move inside `crates/engine`; one revert undoes it;
- cap: it counts as one of the two pieces of open agent work ADR-0007 allows, and starts only
  when fewer than two are open;
- no protected part of ADR-0007: no export of the bridge changes;
- a wrong result shows as a red `cargo test` or clippy; the unchanged suite proves it right;
- stop: if the move would change a key of `crates/engine/mutants-missed.txt`, hand off with the
  key rather than record a new list.
