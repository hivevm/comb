# API-edges-dock-nodes-or-edges: Every node has one connector in the middle of each side, an edge's end docks on a side or on the outline of any node, at any depth, or on another edge, and an edge carries a list of edge labels

- **Status:** 🟡 proposed
- **Date:** 2026-11-17
- **Deciders:** Markus Brigl
- **Applies to:** the edge paths of `crates/engine/src/geometry.rs`, the point where a loop's end meets a node shape's outline in `crates/engine/src/shape.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, `CombOptions`, `addEdge`, and `updateEdge` in `packages/comb/src/api/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer and the edge labels of `packages/comb/src/render/`
- **Supersedes:** [API-edges-dock-side-or-outline](API-edges-dock-side-or-outline.md)

## Context

[API-one-connector-per-side](API-one-connector-per-side.md) gives every node one connector in the
middle of each
side. Every edge leaves one side and enters one, and an edge of a node with itself is refused by
the user's connection and by `addEdge`. A state diagram needs two things that rule forbids:

- several transitions leaving one state from different directions, without all meeting in the
  middle of one side;
- a loop, a transition from a state back to itself.

The feature spec `docs/plan/state-diagram/` asks for both as G-13, drafted there for the
maintainer to land. The decision on node shapes (REN-node-shapes-cover-uml) gives the engine the
point where a line crosses a node's outline.

The forces:

- **What exists stays:** the metric tree, its reference image of the edges, the benchmark, and
  the UML example's class and package diagrams draw their edges by sides. The maintainer chose an
  opt-in: today's sides stay the default.
- **Q-1, Q-2, and REN-virtualized-nested-scene:** an edge stays one cubic in the one edge mesh, so
  the rectangle, the
  split points, the mesh budget, and the precision far from the origin hold.
- **API-edits-report-nested-changes:** the user's connection is proposed to the host's veto. A
  loop the gesture offers
  is a proposal an existing host has never seen. The maintainer chose an option that allows
  loops, off by default, over leaving them to the veto alone.
- **The specification's assumption** that every edge joins two connectors names connectors. An
  end docked on the outline joins no connector; the maintainer amends the assumption with G-13.

G-19 gives an edge several edge labels, each at its own path parameter and label offset, lets the
host application end an edge on another edge at a path parameter of that edge, draws an edge as a
lightning bolt, and ends an edge in an open arrowhead or a hollow triangle, as UML 2.5.1 ends flows,
transitions, includes, extends, and generalizations. G-14 and G-17 add nodes in containers and
border nodes, and an edge between a node and its own container. UML 2.5.1 needs them for the
multiplicities and role names at both ends of an association, the anchor of a comment on a
relationship, the condition of an extend, and the interrupting edge of an interruptible region
(G-20). The human decided on 2026-11-17 that a list of edge labels replaces the one label of an
edge.

[API-edges-dock-side-or-outline](API-edges-dock-side-or-outline.md) docks an end on a side or on
the outline of a node, and an edge carries at most one label. This ADR restates it with these
additions.

## Decision

We will give every node four connectors, one in the middle of each side, and let each end of an
edge either name a side, as today and by default, or dock on the node's outline. A Comb whose
host application allows loops accepts an edge from a node back to itself, drawn as a loop on one
side of the node.

- **Ends:** an end names a node by `source` or `target`, any node at any depth, a container or a
  border node among them, or an edge by `sourceEdge` or `targetEdge` with a path parameter
  `sourceT` or `targetT` from 0 to 1. The TypeScript type of each end is a union of the two. Each
  end names one or the other; the bridge crate refuses an
  end that names both, neither, or a path parameter outside the range, and an edge that ends on
  an edge one of whose ends lies on an edge, on itself, or on an edge of its own ends. Removing an
  edge removes every edge that ends on it, in the same call, and a removal reports them all.
- **Graph data:**
  - `EdgeData` keeps `sourceSide` and `targetSide`, each one of `top`, `right`, `bottom`, `left`,
    or `outline`. `api` fills in `right` and `left` where the host leaves them out, and `top`
    for both of a loop, so that a loop the host adds without a side is drawn above its node.
  - The bridge crate refuses another value as `invalidField`, naming the field and the five
    values.
  - The engine keeps both with the edge, a byte each, as before.
- **An end on an edge** lies at the point of that edge's path at its path parameter, and its
  control point lies on that path's normal there, on the side of the edge's other end, at the
  distance rule of the path between two nodes. It moves as that edge's path moves.
- **An end on a container toward a node it holds:**
  - This rule covers an edge between a container and a node it holds, at any depth.
  - Both ends of that edge dock on the outline.
  - The container's end lies where the line from the container's centre through the held node's
    centre, continued past it, crosses the container's outline.
  - The held node's end lies where that line crosses the held node's outline on the side of the
    container's end.
  - Each control point lies on that line between the two ends, half the distance between them
    from its own end.
  - The path therefore runs straight and stays inside the container.
  - Where the two centres coincide, the line runs to the right, along +x.
  - An end on a side docks at that side's connector, as on any node, and the path between two
    nodes holds; where the two centres coincide, its end on the outline looks to the right.
- **The path between two nodes:**
  - With both ends on a side, the path is API-one-connector-per-side's. It starts at the connector
    of the source's
    side and ends at the connector of the target's side, as one cubic. Each control point lies on
    its end's outward normal, at half the distance between the two ends along that normal's
    axis, and at least 40 world units out. For `right` to `left` that is the horizontal path to
    the bit, so every graph that names no side is drawn by it.
  - An end on the outline lies where the line from its node's centre towards the other node's
    centre crosses its node's outline. Its control point lies on that line, outward, at the same
    distance rule.
  - The arrowhead's tip is the target's end, on a connector or on the outline. It points along
    the path's tangent there.
- **Edge labels:** `EdgeData.label` gives way to `labels`, a list of edge labels, each with an
  identifier unique within its edge, its text, its path parameter, its label offset, and its
  background colour, each placed and kept as G-6 says. `updateEdge` sets the whole list, or clears
  it with `null`. An edge carries at most 8 labels. A label without its own background is drawn
  in its edge's colour as that colour stands, and Comb tells it without one. A label drag moves
  the one label it pressed.
- **Lightning bolt:** `EdgeData` gains an optional `lightning`, off by default. Where it is on, the
  engine draws the path's middle, the part between the path parameters 0.45 and 0.55, as a zigzag
  of two turns across the path, 12 world units wide, and the rest of the path as before.
- **Arrowheads:** `EdgeData.arrow` takes `"end"`, the filled triangle at the target as before and
  the default, `"open"`, two strokes of the edge's width meeting at the target, `"hollow"`, a
  triangle at the target drawn as its outline in the edge's colour around a white fill, or
  `"none"`. The engine meshes each as it meshes the filled one, its tip at the target's end, the
  line of an edge with an open arrowhead running on to the tip, and
  the bridge crate refuses another value as `invalidField`, naming the field and the four values.
- **Loops:**
  - `CombOptions` gains `allowLoops`, off by default. Where it is off, the user's connection and
    `addEdge` refuse an edge from a node to itself, as API-one-connector-per-side decided. The
    connection never
    counts a connector of its own source as compatible, and `addEdge` refuses with its own kind,
    `selfEdge`.
  - Where it is on, `addEdge` accepts a loop. The user's connection counts the source's own
    connectors as compatible while no loop of that node exists, all but the connector it starts
    from, so that a press and release on one connector proposes nothing, and proposes it to the
    veto as any connection.
  - `load` accepts a loop whatever the option, as it does today.
  - A loop leaves and re-enters the side its `sourceSide` names, the top where it names
    `outline`. It starts and ends a quarter of that side's length either side of the middle, as
    one cubic whose control points lie outward along the side's normal, as far out as the side is
    long and at least 40 world units. It runs clockwise around the node, so that a positive label
    offset stands outside it. Its arrowhead enters the node there. Its label's path parameter 0.5
    is the loop's outermost point.
  - Each end lies on the node's outline: from its point on the rectangle's side it moves inward
    along the side's normal until it meets the outline of the node's node shape, and its control
    point moves with it. Both ends move by the same distance, so the loop keeps its form and its
    width and moves inward as a whole, by up to a quarter of the node's height on a diamond. On a
    rectangle and a bar the ends do not move, so their loops are today's to the bit; on a rounded
    rectangle neither, while the side is at least four times its corners' radius long, and on a
    shorter side the ends meet the arc of its corners.
- **Compatible:**
  - A connector is compatible with a connection the user drags from a connector of a source node
    when it belongs to another node, and no edge from the source node to that node exists in that
    direction, whatever its sides; an edge the other way does not count.
  - Where loops are allowed, a connector of the source itself is compatible as well, under the
    same rule, but for the connector the connection starts from.
  - A connection is made only to a compatible connector, and only after the host's veto allows it
    ([API-edits-report-nested-changes](API-edits-report-nested-changes.md)). The node the
    user drags from is
    the edge's source, the one released over its target. The gesture records the sides of the two
    connectors; a host that wants an end on the outline sets it through `updateEdge`.
- **Second edges:** `addEdge` accepts a second edge between two nodes in the same direction, as
  `load` does; the rule of compatibility binds the user's gesture alone.
- **Levels:** at the far level no connector is drawn, and no connection is begun. How a
  connector is hit is decided with the other hit tests
  ([REN-node-content-and-hits](REN-node-content-and-hits.md)).
- **Drawing:**
  - A `connectors` layer joins the world above the nodes and edge labels
    ([REN-virtualized-nested-scene](REN-virtualized-nested-scene.md)). It holds the four connectors
    of the node under the pointer.
  - While the user drags a connection, it holds those of the source and of the node under the
    pointer, each compatible one drawn apart from the others.
  - The connection being dragged is drawn in the overlay as a line from the source's connector to
    the pointer, until it is released.
  - An end on the outline draws no connector of its own.

**Out of scope:**
- more than one connector per side, and connectors the host places or types;
- the user's connection to an edge, which only the host application makes;
- routing edges around nodes, orthogonal routes, and bend points;
- a loop on a corner, or several loops on one node;
- moving an edge's end to another connector or onto the outline by dragging it, which the host
  does through `updateEdge`;
- releasing a connection over a node's outline rather than over one of its connectors.

## Alternatives considered

- **`label` kept beside a list `labels`** — no host application breaks, but two ways to say one
  thing, and every reader of labels handles both. Comb has no release that binds a host to it.
- **Ends on edges at any depth, chains of edges on edges** — every notation that anchors on an
  anchor, but the paths depend on one another in an order the engine would sort per query, and a
  cycle has to be refused anyway. UML 2.5.1 anchors comments and conditions on relationships
  between nodes, which one level holds.
- **A node at the middle of an edge for an anchor** — no new kind of end, but the node moves
  apart from the edge it stands for, and the user can select and drag it away.
- **The lightning bolt as a dash pattern** — no new field, but a dash pattern leaves gaps along
  the path and draws no turn across it.

The alternatives API-one-connector-per-side weighed stand as it records them: two typed connectors,
the nearest
side chosen anew, connectors typed by the host, the two rules of a duplicate, and the other
placements of the control points. Added here:

- **Anchors as entities of their own, several per node, each with an identifier** — as Eclipse
  Draw2d's `ConnectionAnchor`. They are the most general, but give an edge's end an identity the
  bridge, the store, and the changes of API-edits-report-nested-changes would carry, for a need
  the outline already
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

- [API-edges-dock-side-or-outline](API-edges-dock-side-or-outline.md), which this ADR restates with
  ends on edges and containers, the list of edge labels, the lightning bolt, and the kinds of
  arrowhead.
- API-one-connector-per-side and its sources, and `EdgePath::between` in
  `crates/engine/src/geometry.rs` (read on
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
  - The tests of API-one-connector-per-side in `crates/engine/src/geometry.rs` stay and are moved to
    cite this
    decision. They cover the sixteen pairs of sides and the horizontal path of `right` to `left`.
  - Added tests assert that an end on the outline lies on the outline, on the line between the
    two centres, for each node shape and from every direction.
  - Added tests assert that a loop leaves and enters the side it names, its outermost point at
    the parameter 0.5, within `f32` far from the origin.
  - Added tests assert that a loop's ends lie on the outline of each node shape on each side,
    its tangent there pointing into the node, and that a loop on a rectangle, a bar, and a
    rounded rectangle whose side is at least four times `ROUNDED_RADIUS` is today's to the bit.
  - The property test of the budget, `crates/engine/src/graph/budget.rs`, draws its random edges
    with random sides, `outline` and loops among them.
- **Graph data:** the property test of the bridge crate generates the two side fields, `outline`
  and a value outside the five among them. A test asserts that an edge without them is drawn from
  `right` to `left`. Browser tests assert:
  - that `addEdge` refuses a loop without `allowLoops`, and accepts one with it;
  - that `load` accepts a loop either way.
- **The gesture:** the browser tests of API-one-connector-per-side in `examples/metric-tree/e2e/`
  stay and are
  moved to cite this decision. Added browser tests drag from a connector back onto the source:
  - with loops allowed, they assert one loop proposed to the veto;
  - without, they assert none.

  They also `Verifies: G-3`.
- **Ends on edges, labels, lightning:** tests in `crates/engine/src/geometry.rs` assert that an end
  on an edge lies on that edge's path at its path parameter within the precision of Q-4 and follows
  it as its nodes move, that an end on a container toward a node it holds lies on the container's
  outline beyond that node, and that a lightning bolt's turns lie between the path parameters
  0.45 and 0.55. Tests in `crates/engine/src/stroke.rs` assert that an open and a hollow arrowhead
  have their tips at the target's end within the precision of Q-4. The property test of the bridge
  crate generates ends on edges, chains and cycles
  among them, and lists of labels. A browser test of the UML example asserts that an extend's
  condition stays anchored on the extend as its use cases move, and that an association draws a
  multiplicity at each end; that removing an edge removes the edges that end on it and reports them;
  and that dragging one of an edge's two labels moves that label alone and delivers `labelMoved`
  naming it.
