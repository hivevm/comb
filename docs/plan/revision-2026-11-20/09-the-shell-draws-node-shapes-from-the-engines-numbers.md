# Ticket: The shell draws each node shape from the engine's numbers

## What to build

REN-node-shapes-cover-uml decides that the engine computes each node shape's outline and that the
shell draws each node shape from the engine's numbers. The shell computes a part of them again in
`packages/comb/src/render/nodes.ts`:

- the constants `RECTANGLE_RADIUS`, `ROUNDED_RADIUS`, `RING_WIDTH`, `NOTE_FOLD`, and `FRAME_CUT`,
  mirrored from `crates/engine/src/shape.rs`;
- `depthOf` and `foldOf`, whose doc comments say "as the engine's `depth`/`fold` holds it";
- `PROPORTIONS` and the proportions of the actor's figure in `drawFigure`.

The engine already builds the outline as a polyline for its dashes (`outline` and `dashes` in
`shape.rs`). A change of a cap or a proportion in one copy and not the other draws a node shape
where its hit test does not lie.

Evidence: ticket 07 of uml-diagrams named "the shell repeats the engine's `depth` and `fold`" in
*Doubts*, and its review finding 5 settled the caps both copies keep into the ADR. Ticket 08's
review, finding 3, asked to shrink the shell's copy of `NodeShape::drawing`; 50b352d1 did it in
part, and the proportions stayed in the shell.

Let the engine hand the shell each node shape's drawn parts as numbers, as it hands dashes and the
inner rectangle: the points of a polygon, the radii, the ring, the fold, the notch, and the strokes
of a figure. Let `render/nodes.ts` draw what it is handed.

## Acceptance criteria

- [ ] Given `packages/comb/src/render/`, when it is searched, then it holds no constant of a node
      shape, no `depthOf`, no `foldOf`, and no `PROPORTIONS`.
- [ ] Given every node shape, when a test of the engine compares the parts it hands over with the
      outline its hit test and its outline crossing use, then they agree, and a change of the fold
      in `shape.rs` changes the parts handed over.
- [ ] Given `examples/metric-tree/e2e/node-shapes.spec.ts` and `node-shapes-uml.spec.ts`, when they
      run, then they pass with their assertions unchanged.

## Read first

- Touches: `crates/engine/src/shape.rs`, `crates/engine-wasm/src/lib.rs`,
  `packages/comb/src/bridge/index.ts`, `packages/comb/src/render/nodes.ts`
- REN-node-shapes-cover-uml, REN-webgl2-or-canvas-fallback, API-bridge-columns-keep-no-size.
- The seam: the geometry tests of `crates/engine/src/shape.rs`, and the browser tests named above.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate and the bridge, protected parts the maintainer reviews,
and how the parts cross the bridge each frame is a choice that bears on Q-1.
