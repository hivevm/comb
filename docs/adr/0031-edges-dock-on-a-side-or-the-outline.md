# ADR-0031: Every node has one connector in the middle of each side, an edge's end docks on a side or on the node's outline, and a loop is accepted where the host application allows loops

- **Status:** 🟡 proposed
- **Date:** 2026-11-06
- **Deciders:** Markus Brigl
- **Applies to:** the edge paths of `crates/engine/src/geometry.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, `CombOptions` and `addEdge` in `packages/comb/src/api/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer of `packages/comb/src/render/`
- **Supersedes:** [ADR-0025](0025-one-connector-per-side.md)

## Context

[ADR-0025](0025-one-connector-per-side.md) gives every node one connector in the middle of each
side. Every edge leaves one side and enters one, and an edge of a node with itself is refused by
the user's connection and by `addEdge`. A state diagram needs two things that rule forbids:

- several transitions leaving one state from different directions, without all meeting in the
  middle of one side;
- a loop, a transition from a state back to itself.

The feature spec `docs/plan/state-diagram/` asks for both as G-13, drafted there for the
maintainer to land. The decision on node shapes (ADR-0032) gives the engine the
point where a line crosses a node's outline.

The forces:

- **What exists stays:** the metric tree, its reference image of the edges, the benchmark, and
  the UML example's class and package diagrams draw their edges by sides. The maintainer chose an
  opt-in: today's sides stay the default.
- **Q-1, Q-2, and ADR-0012:** an edge stays one cubic in the one edge mesh, so the rectangle, the
  split points, the mesh budget, and the precision far from the origin hold.
- **ADR-0024:** the user's connection is proposed to the host's veto. A loop the gesture offers
  is a proposal an existing host has never seen. The maintainer chose an option that allows
  loops, off by default, over leaving them to the veto alone.
- **The specification's assumption** that every edge joins two connectors names connectors. An
  end docked on the outline joins no connector; the maintainer amends the assumption with G-13.

## Decision

We will give every node four connectors, one in the middle of each side, and let each end of an
edge either name a side, as today and by default, or dock on the node's outline. A Comb whose
host application allows loops accepts an edge from a node back to itself, drawn as a loop on one
side of the node.

- **Graph data:**
  - `EdgeData` keeps `sourceSide` and `targetSide`, each one of `top`, `right`, `bottom`, `left`,
    or `outline`. `api` fills in `right` and `left` where the host leaves them out.
  - The bridge crate refuses another value as `invalidField`, naming the field and the five
    values.
  - The engine keeps both with the edge, a byte each, as before.
- **The path between two nodes:**
  - With both ends on a side, the path is ADR-0025's. It starts at the connector of the source's
    side and ends at the connector of the target's side, as one cubic. Each control point lies on
    its end's outward normal, at half the distance between the two ends along that normal's
    axis, and at least 40 world units out. For `right` to `left` that is the horizontal path to
    the bit, so every graph that names no side is drawn by it.
  - An end on the outline lies where the line from its node's centre towards the other node's
    centre crosses its node's outline. Its control point lies on that line, outward, at the same
    distance rule.
  - The arrowhead's tip is the target's end, on a connector or on the outline. It points along
    the path's tangent there.
- **Loops:**
  - `CombOptions` gains `allowLoops`, off by default. Where it is off, the user's connection and
    `addEdge` refuse an edge from a node to itself, as ADR-0025 decided. The connection never
    counts a connector of its own source as compatible, and `addEdge` refuses with its own kind,
    `selfEdge`.
  - Where it is on, `addEdge` accepts a loop. The user's connection counts the source's own
    connectors as compatible while no loop of that node exists, and proposes it to the veto as
    any connection.
  - `load` accepts a loop whatever the option, as it does today.
  - A loop leaves and re-enters the side its `sourceSide` names, the top where it names
    `outline`. It starts and ends a quarter of that side's length either side of the middle, as
    one cubic whose control points lie outward along the side's normal, as far out as the side is
    long and at least 40 world units. Its arrowhead enters the node there. Its label's path
    parameter 0.5 is the loop's outermost point.
- **Compatible:**
  - A connector is compatible with a connection the user drags from a connector of a source node
    when it belongs to another node, and no edge from the source node to that node exists in that
    direction, whatever its sides; an edge the other way does not count.
  - Where loops are allowed, a connector of the source itself is compatible as well, under the
    same rule.
  - A connection is made only to a compatible connector, and only after the host's veto allows it
    ([ADR-0024](0024-edits-are-reported-as-typed-changes.md)). The node the user drags from is
    the edge's source, the one released over its target. The gesture records the sides of the two
    connectors; a host that wants an end on the outline sets it through `updateEdge`.
- **Second edges:** `addEdge` accepts a second edge between two nodes in the same direction, as
  `load` does; the rule of compatibility binds the user's gesture alone.
- **Levels:** at the far level no connector is drawn, and no connection is begun. How a
  connector is hit is decided with the other hit tests
  ([ADR-0013](0013-node-content-model.md)).
- **Drawing:**
  - A `connectors` layer joins the world above the nodes and edge labels
    ([ADR-0012](0012-virtualized-scene-graph.md)). It holds the four connectors of the node under
    the pointer.
  - While the user drags a connection, it holds those of the source and of the node under the
    pointer, each compatible one drawn apart from the others.
  - The connection being dragged is drawn in the overlay as a line from the source's connector to
    the pointer, until it is released.
  - An end on the outline draws no connector of its own.

**Out of scope:**
- more than one connector per side, connectors the host places or types, and anchors on an edge;
- routing edges around nodes, orthogonal routes, and bend points;
- a loop on a corner, or several loops on one node;
- moving an edge's end to another connector or onto the outline by dragging it, which the host
  does through `updateEdge`;
- releasing a connection over a node's outline rather than over one of its connectors.

## Alternatives considered

The alternatives ADR-0025 weighed stand as it records them: two typed connectors, the nearest
side chosen anew, connectors typed by the host, the two rules of a duplicate, and the other
placements of the control points. Added here:

- **Anchors as entities of their own, several per node, each with an identifier** — as Eclipse
  Draw2d's `ConnectionAnchor`. They are the most general, but give an edge's end an identity the
  bridge, the store, and the changes of ADR-0024 would carry, for a need the outline already
  meets.
- **A field of its own for docking, beside the sides** — clearer to read, but it allows two
  fields that contradict each other. One value of the side, `outline`, says it once.
- **The outline as the default** — every edge of a graph that names no side would move, and with
  it the reference image, the geometry tests, and the benchmark's baselines.
- **Loops left to the veto alone, with no option** — simpler, but an existing host's veto would
  start to see proposals of loops it never had to refuse, and `addEdge`'s refusal, which callers
  rely on, would change for all.
- **A loop drawn as two cubics, or as an arc** — closer to a circle, but the mesh, the split
  points, and the budget are written for one cubic per edge.

## Sources / Prior art

- ADR-0025 and its sources, and `EdgePath::between` in `crates/engine/src/geometry.rs` (read on
  2026-11-06).
- Eclipse Draw2d's `ChopboxAnchor` and `EllipseAnchor`, which end a connection where the line
  between the two figures' centres crosses the figure's bounds or ellipse. Recalled, not re-read
  for this record.
- The notation of a self transition in OMG's UML 2.5.1, chapter 14: a transition whose source and
  target are one state, drawn as a loop. Recalled, not re-read for this record.

## Consequences

- Positive: several edges dock on one node from any direction, and loops are drawn. A state
  diagram can be drawn, and an activity diagram's many edges on one action too.
- Positive: every graph that names no side, or names sides, draws as today. The reference image,
  the geometry tests, and the benchmark's baselines stay. An existing host sees no loop until it
  allows loops.
- Negative / trade-offs: an end on the outline is placed by the two nodes' centres, so edges
  between the same two nodes overlap. Spreading them needs a router, which is out of scope.
- Negative / trade-offs: the gesture still connects connectors. A host that wants the outline
  sets it after the connection, one more `updateEdge` per connection.
- Negative / trade-offs: one loop per node through the gesture. A second loop, on another side,
  is the host's through `addEdge`.
- Follow-ups:
  - releasing a connection over a node's outline;
  - routers;
  - several loops on one node;
  - anchors on edges for notes and association classes.

## Enforcement

Each test below cites this decision with `Verifies:` and its identifier.

- **The path:**
  - The tests of ADR-0025 in `crates/engine/src/geometry.rs` stay and are moved to cite this
    decision. They cover the sixteen pairs of sides and the horizontal path of `right` to `left`.
  - Added tests assert that an end on the outline lies on the outline, on the line between the
    two centres, for each node shape and from every direction.
  - Added tests assert that a loop leaves and enters the side it names, its outermost point at
    the parameter 0.5, within `f32` far from the origin.
  - The property test of the budget, `crates/engine/src/graph/budget.rs`, draws its random edges
    with random sides, `outline` and loops among them.
- **Graph data:** the property test of the bridge crate generates the two side fields, `outline`
  and a value outside the five among them. A test asserts that an edge without them is drawn from
  `right` to `left`. Browser tests assert:
  - that `addEdge` refuses a loop without `allowLoops`, and accepts one with it;
  - that `load` accepts a loop either way.
- **The gesture:** the browser tests of ADR-0025 in `examples/metric-tree/e2e/` stay and are
  moved to cite this decision. Added browser tests drag from a connector back onto the source:
  - with loops allowed, they assert one loop proposed to the veto;
  - without, they assert none.

  They also `Verifies: G-3`.
