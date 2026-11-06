# ADR-draft-node-shapes: A node is drawn and hit in a node shape from a closed set the engine owns

- **Status:** 🟡 proposed
- **Date:** 2026-11-06
- **Deciders:** Markus Brigl
- **Applies to:** the node fields of `crates/engine-wasm/` and of `NodeData` in `packages/comb/src/store/`, the node-shape geometry of `crates/engine`, the layout of content and `heightOf` in `crates/engine/src/content.rs` and `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs`, and the drawing of nodes in `packages/comb/src/render/`

## Context

Comb draws every node as a rectangle. A state diagram needs other node shapes: a state is a
rounded rectangle, an initial state a filled circle, a final state a ringed circle, and a choice
a diamond. An activity diagram needs a bar for a fork and an ellipse or a diamond, and a use
case diagram an ellipse. The feature spec `docs/plan/state-diagram/` asks for these as G-13,
drafted there for the maintainer to land.

The forces:

- **Q-1 and Q-2:** a graph of node shapes stays as fluid at 50,000 nodes as one of rectangles.
  The engine owns geometry, culling, and hit tests (ADR-0012, ADR-0013), and the shell draws
  from pooled views. A node shape that only the shell knows would leave the engine hitting and
  culling a rectangle the user does not see.
- **ADR-0013:** content is a closed set of elements the engine lays out. A closed set of node
  shapes keeps the same split: the host describes, the engine computes, the shell draws.
- **ADR-0026:** the host gives a node's width, and the engine gives its height from its content.
  A node shape changes how much room the content has, so the height depends on it.
- **Q-5 to Q-7:** a new field crosses the bridge, where it is checked, and is refused by a typed
  problem when it is unknown.

The maintainer chose a closed set over node shapes the host draws itself. Height follows a rule
per node shape, and the host keeps giving the width alone.

## Decision

We will give every node a node shape from the closed set `rectangle`, `rounded-rectangle`,
`ellipse`, `circle`, `ringed-circle`, `diamond`, and `bar`, owned by the engine. The engine
computes each node shape's outline, the inner rectangle its content is laid out in, its height,
its hit test, and the point where a line from inside crosses its outline. The shell draws each
node shape from the engine's numbers.

- **Graph data:** `NodeData` gains an optional `shape`. `api` fills in `rectangle` where the
  host leaves it out, as it fills in an edge's colour. It crosses the bridge as a code. The bridge
  crate refuses a value outside the set as `invalidField`, naming the node, the field, and the
  set.
- **Content and node shape:**
  - The *content node shapes* are `rectangle`, `rounded-rectangle`, `ellipse`, and `diamond`.
    Each lays its content out in its inner rectangle:
    - `rectangle`: today's node, its corners rounded by 6 as the shell draws them now (read in
      `packages/comb/src/render/nodes.ts`); the node less today's padding.
    - `rounded-rectangle`: the same, its corners rounded by 10. That radius lies within the
      padding of 10 above and below and 12 at the sides (`crates/engine/src/content.rs`), so
      content lays out as in a rectangle.
    - `ellipse`: the rectangle inscribed in it, its sides 1/√2 of the ellipse's axes, less the
      padding.
    - `diamond`: the rectangle half its width and half its height, centred, less the padding.

    The content is laid out from the inner rectangle's left and top rounded down to whole world
    units, so that the layout's sums in `f32` stay as exact there as at a node's corner. Its
    padding at the left and the top shrinks so by less than 1 world unit.
  - The *filled node shapes* are `circle`, `ringed-circle`, and `bar`. They hold no content: the
    bridge crate refuses content in one with a kind of its own that names the node.
- **Height:**
  - A content node shape is as high as its inner rectangle needs to hold its content laid out to
    the inner rectangle's width. For a rectangle that is today's height.
  - A circle and a ringed circle are as high as wide.
  - A bar is 8 world units high.
  - `heightOf` takes the node shape as an optional third argument, `rectangle` where it is left
    out, so that every existing call answers as before.
- **Hit test:** a node is hit within its outline, exactly: the ellipse by its equation, the
  diamond by its four edges, the rounded rectangle by its corners. The rectangle stays hit as its
  bounding rectangle, as today, its corners of 6 included. A press inside the node's
  bounding rectangle but outside its outline hits what lies below, as a press on the empty canvas
  does.
- **Crossing:** the engine gives, for a node and a point outside it, the point where the line
  from the node's centre towards that point crosses the outline. Docking an edge's end on the
  outline, a decision of its own, uses it.
- **Drawing:**
  - The content node shapes are drawn as a node is today: the white fill and the border, its
    width and colour following the selection, in the node shape's outline.
  - The filled node shapes are filled in the near-black of a node's texts, `0x1F2430`. The ringed
    circle is a filled circle of half the radius inside an unfilled ring.
  - Each view draws its node shape in the pooled `Graphics` that draws a node's rounded rectangle
    today. No layer is added, and no `Graphics` is made per node beyond the pool.
- **Levels:**
  - The near level draws the node shape and its content.
  - The middle level draws the node shape and the texts of role title.
  - The far level draws a particle, as today, whatever the node shape.

**Out of scope:** node shapes the host application draws or registers; a colour of a node; a
corner radius, a ring width, or a bar thickness set by the host; text that follows a curved
outline; nested nodes; and an edge's end docked on the outline, which a decision of its own takes
up.

## Alternatives considered

- **Node shapes the host application draws, as a path or a polygon** — open to every notation,
  but the engine would hit, cull, and cross arbitrary outlines, the bridge would carry a path
  format, and Q-7 would bound its size. The maintainer chose the closed set: a new node shape
  costs a revision of this record.
- **A node shape as a content element** — a shape drawn inside the node's rectangle, which keeps
  the data format. The node stays hit and culled as a rectangle, an edge still ends at the
  rectangle, and a diamond's corners would be clicked through.
- **A node shape by a registered icon** — cheap, since icons exist (ADR-0013), but an icon is a
  texture: it neither scales crisply at every zoom nor gives an outline to hit or to dock on.
- **The host gives the height** — `NodeData` gains a `height` that overrides the content's. It
  frees a circle of any size, but content may overflow, and ADR-0026's promise that the host
  places a node where Comb draws it needs a second source of height.
- **Content allowed in the filled node shapes** — a name inside an initial state. UML draws
  none, and a bar of 8 world units holds no line, so a refusal says what a host did wrong.

## Sources / Prior art

- ADR-0013 and ADR-0026, and `crates/engine/src/content.rs` for the padding and the rows (read on
  2026-11-06).
- The notation of states and pseudostates in OMG's UML 2.5.1, chapter 14 (State Machines): a state
  as a rounded rectangle, an initial pseudostate as a filled circle, a final state as a circle
  around a filled circle, a choice as a diamond, and a fork or join as a bar. This is recalled,
  not re-read for this record; ticket 01 checks it against the specification text.
- Eclipse Draw2d's figures (`RectangleFigure`, `RoundedRectangle`, `Ellipse`, `Polygon`) and
  mxGraph's built-in shapes: graph libraries that keep a closed set of node shapes beside a way
  to register more. Recalled, not re-read for this record.

## Consequences

- Positive: state, activity, and use case diagrams get the node shapes UML gives them. Every
  graph that names no node shape draws, hits, and lays out as today, so the metric tree, its
  reference image, and the benchmark stay.
- Positive: the engine keeps owning what the user sees: culling, hit tests, and heights follow
  the node shape, with no second geometry in the shell.
- Negative / trade-offs: a node record grows by a byte. A content node shape other than the
  rectangle wastes room at its corners, so an ellipse or a diamond of the same content is higher.
- Negative / trade-offs: the far level draws every node shape as the same particle, so node
  shapes cannot be told apart there.
- Negative / trade-offs: the near-black of the filled node shapes is fixed until a colour of a
  node is decided.
- Follow-ups:
  - a colour of a node;
  - an edge's end docked on the outline;
  - the node shapes of later diagrams (an actor, a note, a component);
  - nested nodes.

## Enforcement

Each test below cites this ADR with `Verifies:` and its identifier.

- **Geometry:** tests in `crates/engine` assert for each node shape:
  - its inner rectangle, and its height for given content;
  - its hit test at points on, just inside, and just outside the outline;
  - the crossing of lines from every direction.

  They take the awkward cases of the conventions, nodes far from the world's origin among them. A
  property test asserts that every crossing lies on the outline within the precision of Q-4.
- **Graph data:** the property test of the bridge crate generates the field, values outside the
  set among them, and content in a filled node shape. A test asserts that a node without the
  field is a rectangle that lays out to today's height.
- **Drawing and hits:** browser tests through `comb/testing` assert, for each node shape:
  - what the canvas draws at each level;
  - that `heightOf` gives the height drawn;
  - that a press inside the bounding rectangle but outside the outline selects nothing.

  The metric tree's tests, the reference image of the edges among them, pass unchanged.
