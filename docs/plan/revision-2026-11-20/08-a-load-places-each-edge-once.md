# Ticket: A load places each edge once, after the nesting and the regions are laid out

## What to build

A load builds the graph in phases that each place edges: `Graph::new` in
`crates/engine/src/graph.rs` places every edge; `Graph::nested` then places anew every edge at a
held node through `place_nested_at` (`crates/engine/src/graph/edges.rs`), whose `nesting_places`
does not ask whether one end holds the other; and the layout of the regions places again through
`reboxed`. `path_of` reads `lies_in`, so every edit of the nesting has to remember to place anew.
ARCH-engine-edits-nested-graph has a load place once and an edit change in place.

Evidence: the second review of ticket 10 of uml-diagrams, finding 12, asked no action: a load
places twice the edges between two siblings in a container that both dock on the outline, which
costs placement time on loads of nested graphs. Ticket 01's hand-off names the nesting checked
twice per load. The benchmark was not run for tickets 09 and 10, which add columns to a load.

Let a load nest and lay out first and place each edge once, and let `place_nested_at` remain for
`move_into` alone.

## Acceptance criteria

- [ ] Given a random nested and divided graph, when it is loaded, then the engine's count of
      placements shows each edge placed once.
- [ ] Given the same graphs, when a property test compares the paths with today's load, then they
      are equal.
- [ ] Given a `move_into`, when it runs, then it places anew only the edges whose nesting decides
      their path, counted the same way.

## Read first

- Touches: `crates/engine/src/graph.rs`, `crates/engine/src/graph/edges.rs`,
  `crates/engine/src/graph/containers.rs`, `crates/engine/src/graph/regions.rs`
- ARCH-engine-edits-nested-graph, API-edges-dock-nodes-or-edges.
- The seam: `crates/engine/src/graph/tests.rs` and its count of placements.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the engine's graph, a protected part the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
