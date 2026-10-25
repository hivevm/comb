# Ticket: A rebuild of the index builds its grids and places no edge again

## What to build

`Graph::index` (`crates/engine/src/graph/index.rs`) builds the grids again and, before that,
computes every edge's path, bounds, and label point anew, free slots included. A rebuild follows
additions and moves (`keep_index`), and every addition, `update_edge`, `move_label`, and
`translate` has already re-placed the edges it changed, so a rebuild recomputes what is current:
the placement of all edges belongs to a load. Move the placement of every edge to where the graph
is built from a load, so that `index` builds the grids from what is placed, and say so in the
module's comment and the overview's *Engine* entry.

Verify first that every path into `keep_index` leaves the edges it touched placed; if one does
not, that is a defect to fix with a regression test, not a reason to keep the recomputation.

## Acceptance criteria

- [ ] Given the property test of edits against a scan (`graph/tests.rs`), when it runs, then it
      passes (`Verifies: ADR-0022`).
- [ ] Given a test that moves nodes until the index is built again, when it compares the edges'
      paths, bounds, and label points before and after the rebuild, then they are the same, and no
      edge is placed during the rebuild (a count of placements).
- [ ] Given `cargo test` and the benchmark's drag gesture, when they run, then they pass.

## Read first

- ADR-0022 (*Index*, *No rebuild per edit*), ADR-0010 (*Origin*); `docs/CONVENTIONS.md` (*Work a
  frame need not redo is pinned by a count*).
- `crates/engine/src/graph/index.rs` (`keep_index`, `index`), `graph/edges.rs` (`place_edge`),
  `graph.rs` (`Graph::new`).

## Blocked by

- None (can start immediately)

## Mode

unattended: tests decide it, the change stays in the engine's graph module, touches no part the
harness ADR keeps with the human (ADR-0007), and one revert undoes it. Stop: where a path into a
rebuild turns out to leave an edge unplaced, fix it with its regression test and hand off the
rest.
