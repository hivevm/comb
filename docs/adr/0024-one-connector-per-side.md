# ADR-0024: Every node has one connector in the middle of each side, and an edge records the side it leaves and the side it enters

- **Status:** 🟡 proposed
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** the edge paths of `crates/engine/src/geometry.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer of `packages/comb/src/render/`

## Context

G-3 asks that dragging from a connector of one node and releasing over a compatible connector of
another creates an edge, and that released anywhere else it creates none. The specification
assumes every edge connects one connector of a node to one connector of another
([Assumptions](../SPECIFICATION.md#assumptions)), and the glossary makes a connector a point on a
node where an edge starts or ends. Nothing says how many connectors a node has, where they lie,
or what makes one compatible.

Today an edge has no connector of its own: `EdgePath::between` runs every path from the middle of
the right side of its source to the middle of the left side of its target, a cubic Bézier curve
whose control points pull horizontally out of both ends, by half the horizontal distance and at
least 40 world units, so that an edge leaves and enters level. G-9's metric tree flows from left
to right, which that path draws. A tree that flows top to bottom, or an edge back to a node
further left, cannot be drawn so that it reads.

The stroke (ADR-0012) relies on three properties of the path, not on its direction: it is one
cubic, so it lies in the hull of its four control points, which the rectangle's chords rest on; a
cubic crosses each of the four lines of the grown rectangle at most three times, which bounds the
split points at sixteen; and the arrowhead's tip is the path's end, its direction the path's
tangent there. Q-4 asks for the path within 0.5 px of a reference computation.

The host application describes what a node means; G-10 gives it node content, and none of it
types a connector. ADR-0013 leaves connectors out of node content.

## Decision

We will give every node four connectors, one in the middle of each side, `top`, `right`,
`bottom`, and `left`, record in each edge the side of its source it leaves and the side of its
target it enters, by default `right` and `left`, and draw its path as one cubic whose control
points pull out of each end along that side's outward normal.

- **Graph data:** `EdgeData` gains `sourceSide` and `targetSide`, each one of the four sides,
  filled in by `api` as `right` and `left` where the host application leaves them out, as it
  fills in an edge's colour and arrowhead. The bridge crate refuses another value as
  `invalidField`, naming the field and the four sides. The engine keeps both with the edge.
- **The path:** it starts at the connector of the source's side and ends at the connector of the
  target's side. Each control point lies on its end's outward normal, at half the distance
  between the two ends along that normal's axis, and at least 40 world units out. For `right` to
  `left` that is today's path to the bit, so every graph that names no side is drawn as before.
  The arrowhead's tip is the target's connector, and it points along the path's tangent there,
  into the target's side.
- **Compatible:** a connector is compatible with a connection the user drags from a connector of
  a source node when it belongs to another node, and no edge from the source node to that node,
  in that direction, exists, whatever sides that edge has; an edge the other way does not count.
  A connection is made only to a compatible connector, and only after the host's veto allows it
  (ADR-0023). The node the user drags from is the edge's source, the one released over its
  target.
- **Self-edges:** a user's connection and `addEdge` refuse an edge from a node to itself, the
  connection by never counting a connector of its own source as compatible, `addEdge` with a
  generated kind of its own. `load` keeps accepting one, as it does today: the specification's
  assumption that every edge joins a connector of one node to one of another
  ([Assumptions](../SPECIFICATION.md#assumptions)) is not enforced for a load.
- **Second edges:** `addEdge` accepts a second edge between two nodes in the same direction, as
  `load` does; the rule of compatibility binds the user's gesture alone.
- **Levels:** at the far level no connector is drawn, and no connection is begun. How a
  connector is hit is decided with the other hit tests.
- **Drawing:** a `connectors` layer joins the world above the nodes and edge labels (ADR-0012),
  with the four connectors of the node under the pointer, and while the user drags a connection,
  those of the source and of the node under the pointer, each compatible one drawn apart from the
  others. The connection being dragged is drawn in the overlay as a line from the source's
  connector to the pointer, until it is released.

**Out of scope:** more than one connector per side, and connectors the host application places
or types; routing edges around nodes; moving an edge's end to another connector by dragging it,
which the host does through `updateEdge`.

## Alternatives considered

- **Two connectors, an output on the right and an input on the left** — the path stays as it is
  and compatibility is "an output to an input", but a graph that flows top to bottom, or an edge
  that runs back, keeps the backward S-curve it has today.
- **The nearest side, chosen anew as the nodes move** — no side to record and a path that always
  takes the short way, but an edge then jumps from side to side during a drag, and the host
  cannot persist where the user connected it.
- **Connectors typed by the host application, compatible by type** — what dataflow editors such
  as Rete.js and litegraph.js offer, but G-3 names no types, and the veto lets the host refuse
  what its model does not allow without a type system in Comb.
- **A duplicate as an edge with the same source, target, and sides** — two edges from one node to
  another in the same direction would then be possible by connecting other sides, which draws one
  relation twice; the sides are where an edge is drawn, not what it means.
- **A duplicate as any edge between the two nodes, either way** — it would refuse a cycle of two
  nodes, which a dataflow or dependency graph may hold on purpose.
- **Control points at a fixed distance, or along the line between the ends** — simpler to state,
  but a fixed distance bends short edges into loops and long ones barely, and a pull along the
  line no longer leaves a connector square to its side, and changes every existing path.

## Sources / Prior art

- `EdgePath::horizontal` and `EdgePath::between` in `crates/engine/src/geometry.rs`, and the
  stroke's argument of ADR-0012 (*The rectangle*, *Sixteen split points*), as they stand (read on
  2026-10-24).
- xyflow's `Position` of a handle, `left`, `top`, `right`, and `bottom` —
  <https://reactflow.dev/api-reference/types/position> (read 2026-10-24): the same four sides,
  there as places of a handle the application puts on a node.

## Consequences

- Positive: a graph that flows in any of four directions is drawn so that it reads, and a graph
  that names no side looks exactly as it does today, so the reference image of the edges and every
  geometry test stay.
- Positive: the path is still one cubic, so the rectangle, the sixteen split points, the mesh
  budget, and the precision far from the world's origin of ADR-0010 and ADR-0012 hold unchanged;
  since every control point pulls along an axis, graph data still describes no straight slanted
  edge.
- Negative / trade-offs: an edge record grows by two sides, a byte each in the engine.
- Negative / trade-offs: with the duplicate rule, a user cannot draw a second edge between two
  nodes in the same direction, even to another side; the host can, through `addEdge`.
- Negative / trade-offs: `addEdge` refuses a self-edge that `load` accepts, so a graph loaded with
  one cannot be rebuilt edge by edge through `addEdge`.
- Negative / trade-offs: the host's veto is asked only at release, so a connector drawn as
  compatible during the drag may still be refused.
- Follow-ups: whether a node may show connectors on some sides only; reconnecting an edge by
  dragging its end.

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0024`.

- **The path:** tests in `crates/engine/src/geometry.rs` assert, for each of the sixteen pairs of
  sides, that the path starts and ends at the two connectors and leaves and enters along each
  side's normal, and that `right` to `left` is the path of today for the cases the existing tests
  hold, edges that run backwards among them. The property test of the budget,
  `crates/engine/src/graph/budget.rs`, draws its random edges with random sides, so that ADR-0012's
  assertions hold for every pair; it also `Verifies: Q-4`.
- **Graph data:** the property test of the bridge crate generates the two side fields, a value
  outside the four among them, and a test asserts that an edge without them is drawn from `right`
  to `left`, and a browser test that `addEdge` refuses an edge from a node to itself.
- **The gesture:** browser tests in `examples/metric-tree/e2e/` drag from a connector and release
  over a connector of another node, over the node's own connector, over a node that an edge from
  the source already reaches, over the empty canvas, and at the far level, and assert one edge
  with the dragged sides in the first case and none in the others; they also `Verifies: G-3`.
