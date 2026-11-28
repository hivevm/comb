# Ticket: The world's limit is checked after the regions are laid out

## What to build

ARCH-one-workspace-per-example (*World*) decides that the core keeps the graph within the world's
limit. Today the bridge asks the engine about a node's box before the regions are laid out, in
three places:

- `checked_height` in `crates/engine-wasm/src/graph_data/checks.rs`, through the engine's
  `height_within`;
- `within_world_divided` in `crates/engine-wasm/src/graph_data/regions.rs`, through the engine's
  `division_within`, called by a load, `addNode`, and `updateNode` only where the data sets
  regions;
- `within_world` in `crates/engine-wasm/src/graph_data/load.rs`, on each node's world position
  while the regions of a divided node still lie at its origin.

A font handed over after a load is checked nowhere: `lay_out_heights` in
`crates/engine-wasm/src/lib.rs` lays every node out anew through the engine's `set_content`.
Ticket 05 of this revision takes that path.

The layout itself (`arrange` and `lay_out_regions` in `crates/engine/src/graph/regions.rs`) then
grows a divided node, and moves the nodes its regions hold, past what was checked. Two paths are
known to escape:

- a patch of `updateNode` that sets content alone on a node already divided: `set_content` lays
  the regions out again below the new top, and `within_world_divided` is not called;
- a load of a node held in a region of a divided node: the region moves to its place after the
  node's world position was checked, and the held node keeps its relative position, so it can lie
  past `WORLD_LIMIT` (the probe in the backlog entry reached about 1.77 × `WORLD_LIMIT`).

Evidence:

- ticket 07 of revision-2026-11-20 (PR #109) took five rounds of review; the fixes added the
  world-limit refusal per axis and `division_needs`, and its reviews found both paths above;
- ticket 04 of revision-2026-11-20 (PR #118) took three rounds and moved the height check from the
  bridge into the engine (`height_within`), which the regions' layout still does not consult;
- the backlog entries `a-content-patch-of-a-divided-node-is-not-held-to-the-world.md` and
  `a-loaded-node-in-a-region-lies-past-the-world.md`, recorded by those reviews. This ticket is
  made from them, and the commit that files it deletes them.

Let the engine answer, before anything changes, whether the boxes a load, an `addNode`, or an
`updateNode` would lay out lie within the world's limit, from the same layout it then applies, so
that one rule refuses every path as `beyondWorld`. Whether the engine lays out on a copy, or
computes the extent the layout would give without applying it, is the session's choice to settle
with the maintainer. The font hand-over is ticket 05 of this revision.

The human decided on 2026-11-28: an edit that would push a node past the world's limit is refused,
never cut. The rest of Comb refuses what lies beyond `WORLD_LIMIT`, a refused edit changes nothing,
and a cut would change the host's data without telling it.

## Acceptance criteria

- [ ] Given a node divided into regions near the world's limit, when `updateNode` patches its
      content alone so that the regions laid out below the new top pass the limit, then the call is
      refused as `beyondWorld`, naming `height`, and the graph is unchanged.
- [ ] Given the graph data of the probe in the deleted backlog entry (a node divided across into
      5 regions of `WORLD_LIMIT / 5`, in its fifth region a node at `(-0.99, -0.99) × WORLD_LIMIT`,
      itself divided across into 2 regions of `0.98 × WORLD_LIMIT`), when it is loaded, then the
      load is refused as `beyondWorld`, and no node of an accepted load lies past `WORLD_LIMIT`
      once its regions are laid out.
- [ ] Given the property tests of `crates/engine-wasm/src/properties.rs`, when they generate
      divided nodes, then they also generate positions and sizes near the world's limit, and every
      accepted call leaves every node's far side within `WORLD_LIMIT`.
- [ ] Given `crates/engine-wasm/src/graph_data/`, when it is searched, then a node's box is checked
      against the world's limit in one function that a load, `addNode`, and `updateNode` reach.

## Read first

- Touches: `crates/engine/src/graph/regions.rs`, `crates/engine/src/graph/resize.rs`,
  `crates/engine-wasm/src/graph_data/checks.rs`, `crates/engine-wasm/src/graph_data/regions.rs`,
  `crates/engine-wasm/src/graph_data/load.rs`, `crates/engine-wasm/src/graph_data/update.rs`,
  `crates/engine-wasm/src/properties.rs`
- ARCH-one-workspace-per-example (*Bridge*, *World*), ARCH-regions-are-container-slots
  (*Division*), API-bridge-columns-keep-no-size, Q-7.
- Conventions: *Check a value as the engine keeps it*, *A refusal added at the bridge is traced to
  the shell's callers*, *A bulk path is tried at the limits of a load*.
- The seam: the refusal tests of `crates/engine-wasm/src/graph_data/regions.rs` and
  `crates/engine/src/graph/resize.rs`, and `properties.rs`.
- Related backlog entries left for the maintainer: `add-node-sums-a-nested-position-in-f32.md`
  and `a-region-whose-kept-position-passes-its-far-side-overflows-the-grid.md`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate and the engine's graph, protected parts the maintainer
reviews.
