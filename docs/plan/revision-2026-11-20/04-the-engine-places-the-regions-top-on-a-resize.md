# Ticket: The engine computes a node's height and its regions' top, and a resize places them anew

## What to build

The height a node's content needs, and the top below which its regions lie, are put together in the
bridge crate rather than in the engine:

- `crates/engine/src/shape.rs` holds three overlapping functions of a node shape's height
  (`height`, `needed`, `sized`);
- `crates/engine-wasm/src/graph_data/checks.rs` combines them with the laid content in
  `node_height` and `content_top`;
- the bridge crate pushes the result into the engine through `Graph::set_top` and the `top` of
  `Graph::divide`, from a load (`graph_data/load.rs`), from `addNode`, and from `updateNode`
  (`crates/engine-wasm/src/lib.rs`, `lay_out_heights`);
- `Graph::resize` in `crates/engine/src/graph/resize.rs` takes the content's height as an argument,
  whose meaning ticket 08 of uml-diagrams changed, and never computes the regions' top anew, since
  the engine does not hold the content.

So a divided actor resized narrower than 24, or a divided hourglass narrower than 32, whose drawing
follows its width, keeps a stale top: its regions overlap its drawing until its content or its
fonts change. That contradicts ARCH-regions-are-container-slots, whose regions divide the part of a
node's box below its content.

Evidence: the second review of ticket 08 of uml-diagrams, finding 4 (`content_top` ignored the
drawing), fixed for a load and an edit in 8bdf7d1d; its hand-off left "a resize does not re-place
regions, for any node shape" open in *Doubts*, and named the changed meaning of the resize's
argument. The hand-off of the uml-diagrams branch carries it as a known gap.

Let the engine hold each node's laid content height and its count of rows, put by one call, and
compute the node's height and its regions' top itself from one function of `shape.rs`. Let
`Graph::resize` lose its content argument and lay the regions out from the top it computes.

## Acceptance criteria

- [ ] Given a divided actor 40 wide, when it is resized to 16 wide, then its first region begins
      below the actor's drawing at 16 wide and its content, in an engine test and in a browser
      test through `comb/testing`'s inspection.
- [ ] Given the bridge crate, when it is read, then it calls no `set_top` and holds no
      `content_top` or `node_height`.
- [ ] Given `NodeShape`, when it is read, then it has one public function of a node's height, and
      the existing height tests of the engine and of `height-of.spec.ts` pass against it.

## Read first

- Touches: `crates/engine/src/shape.rs`, `crates/engine/src/graph/resize.rs`,
  `crates/engine/src/graph/regions.rs`, `crates/engine-wasm/src/graph_data/checks.rs`,
  `crates/engine-wasm/src/graph_data/load.rs`, `crates/engine-wasm/src/lib.rs`
- ARCH-regions-are-container-slots, REN-node-content-and-hits, REN-node-shapes-cover-uml.
- `.scratch/uml-diagrams-08-symbol-node-shapes.md` where it still exists; else the commit message
  of b9550b3e.
- The seam: the engine's tests in `crates/engine/src/graph/tests.rs`, and
  `examples/metric-tree/e2e/resize.spec.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the engine's graph and the bridge crate, protected parts the maintainer
reviews (DEV-implementer-and-fresh-reviewer).
