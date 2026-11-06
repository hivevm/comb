# Spec: Node shapes, edges on the outline, and loops, shown in a state diagram of Comb

<!-- The destination of a piece of work larger than one agent session; its tickets lie next to it.
     Disposable: the design revision deletes it once its tickets have merged. Decided in
     docs/adr/0006-feature-layer.md. -->

## Problem

A developer who weighs Comb for state machines, workflows, or UML can draw only boxes joined by
one curve per side. A state is a rounded box, the start of a machine a filled circle, its end a
ringed one, and a decision a diamond. A state may also lead back to itself, and several
transitions often leave the same side of a state. Comb draws every node as a rectangle. It
refuses an edge of a node with itself, from the user's connection and from `addEdge`, and lets
only one connector sit on each side. So a state diagram cannot be drawn with Comb today, nor an
activity or a use case diagram, whose node shapes the same capabilities open up.

This spec is the first stage of a model of diagram elements for Comb, in which nodes have node
shapes, edges dock
anywhere on a node's outline, and edges carry decorations and several labels, and nodes nest.
It covers what the state diagram needs: node shapes, edges that dock on the outline, and loops.

## Solution

The host application sets a node's **node shape**, from a closed set:
- rectangle, the default;
- rounded rectangle;
- ellipse;
- circle;
- ringed circle;
- diamond;
- bar.

Comb draws the node in that node shape, hits it within its outline, and lays its content out inside.
A filled node shape, such as the initial state's circle or a fork's bar, carries its colour and no
content.

The host application lets an edge **dock on the outline**: its end then lies where the line
towards the other end crosses the node's outline, instead of at the middle of a side. Any
number of edges may dock on one node, from any direction. An edge that names a side keeps
today's connector.

The host application may add a **loop**: an edge from a node back to itself, drawn as a curve
that leaves and re-enters one side of the node. Comb accepts a loop where the host application
allows loops, and the user can then drag a connection from a node back onto it.

The UML example gains a third diagram: the **state diagram of a Comb's life**.
- The states are: created; loading its engine; ready; rendering a frame; engine lost; destroyed.
- It has an initial and a final state.
- A choice decides whether the engine loaded.
- A loop on *ready* stands for each edit Comb applies.

It is edited as the other diagrams are. The palette drops a state, an initial state, a final
state, or a choice. The sidebar renames a state and names a transition's event. A connection adds
a transition docked on the outline, a drag back onto a state adds a loop, and Delete removes the
selection.

## Existing behaviour

- **What stays:** a node without a node shape stays a rectangle, and an edge that docks on no
  outline keeps its sides and its connectors. Every graph that uses neither draws as today. That
  covers the metric tree, the benchmark, the class diagram, and the package diagram. Pinned by:
  - the metric tree's browser tests, `edge-styles` with its reference image among them;
  - the benchmark's tests;
  - the UML example's browser tests;
  - the engine's geometry and hit tests.

  They run unchanged after every ticket.
- **What changes:**
  - `addEdge` and the user's connection accept an edge of a node with itself where the host
    application allows loops. Without that, they refuse it as today (`selfEdge`).
  - `load` already accepts a loop, and draws it as a loop from then on, not as today's
    degenerate curve. No test pins today's drawing of one, so ticket 03 pins the loop.
- **What grows:**
  - the content's layout box: a node's content is laid out inside its node shape's inner rectangle,
    which for a rectangle is the node itself;
  - `heightOf`, which answers for each node shape;
  - the hit test of a node.

## Goals served

- **G-13** (new, drafted here; the maintainer lands it in the specification,
  [`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). Proposed text, after G-12:

  > **G-13** — When the host application sets a node's node shape (a rectangle, a rounded
  > rectangle, an ellipse, a circle, a ringed circle, a diamond, or a bar), the system shall draw
  > the node in that node shape, hit it within its outline, and lay its content out inside it. When
  > the host application lets an edge dock on the outline, the system shall end the edge where
  > the line towards its other end crosses the node's outline, for any number of edges on one
  > node. When the host application allows loops, the system shall accept an edge from a node
  > back to itself, from `addEdge` and from the user's connection, and draw it as a loop on one
  > side of the node.

- **G-12** amended (drafted here; the maintainer lands it): its sidebar switches between three
  UML diagrams; a state diagram of a Comb's life shows each state in the node shape UML gives it and
  each transition as an edge docked on the outline, labelled by its event; the palette adds
  states.
- **Q-1, Q-2** hold for a graph of node shapes, outline docking, and loops, measured by a variant of
  the benchmark. Q-4, Q-5, Q-6, and Q-7 bind every new field.
- It uses, and so shows, G-1 to G-5, G-10, and G-11.

The specification's assumption that every edge joins two connectors names connectors; an edge
docked on the outline joins two points of outlines. The maintainer amends the assumption with
G-13.

## User stories

1. As a developer of a state machine editor, I want to set a node's node shape, so that a state, an
   initial state, a final state, and a choice look as UML draws them.
2. As a developer, I want a shaped node to be hit within its outline, so that a click beside a
   circle or a diamond selects nothing.
3. As a developer, I want a shaped node's content laid out inside its node shape, and its height
   from `heightOf`, so that I place shaped nodes as I place boxes.
4. As a developer, I want an edge to dock where it meets the node's outline, so that several
   transitions leave one state from different directions without overlapping.
5. As a developer, I want to allow loops, so that a state can lead back to itself.
6. As a user of the example, I want to drag a connection from a state back onto itself, so that
   I draw a self transition with the same gesture as any other.
7. As a user, I want to drop states, initial and final states, and choices from the palette,
   name states and events in the sidebar, and delete them, so that I can draw a state machine.
8. As a developer weighing Comb, I want a state diagram in the UML example, so that I see that
   Comb carries diagrams beyond boxes and arrows.
9. As the maintainer, I want the 50,000-node goals measured for shaped graphs, so that the new
   capabilities cost no fluidity nobody sees.
10. As a developer of an existing host application, I want my graphs to draw as before, so that
    the new capabilities cost me nothing until I use them.

## Implementation decisions

- **Closed set of node shapes.** The engine owns each node shape's outline, its inner rectangle for
  content, its hit test, and the point where a line crosses its outline, as it owns the layout
  of content today. The shell draws each node shape from the engine's numbers. A node shape is a
  field of a node, crossing the bridge as a code and checked there. A new node shape is a revision
  of the set.
- **Docking on the outline** is a field of each end of an edge: it either names a side, as
  today, or docks on the outline. With every end of an edge on a side, the path is today's
  cubic. With an end on the outline, that end's control point pulls out along the line between
  the two nodes' centres. The arrowhead's tip lies on the target's outline.
- **Loops** are an option of Comb, off by default. Where it is on, the gesture counts a
  connector or the outline of its own source as compatible, and `addEdge` accepts a loop. A
  loop leaves and re-enters one side of its node, the side the host application names, the
  top by default, as a cubic whose two control points lie outside that side. Its label sits at
  the loop's outermost point.
- **Engine and mesh.** Node shapes and outline points are computed by the engine and drawn in the
  existing layers: the node shape by the node's view, edges in the one edge mesh, hit tests in the
  engine. No new layer, and no per-node drawing outside the pools.
- **Levels of detail.** The far level draws a shaped node as a particle of its colour, as
  today. The middle level draws its outline without content.
- **The UML example's state diagram** is a third diagram of the sidebar's choice, edited as the
  others are, kept while another is shown. Its kinds of node are state, initial state, final
  state, and choice; its one kind of relationship is the transition, a solid grey edge with an
  arrowhead, labelled with its event.
- **The benchmark** gains a variant whose nodes take the node shapes in turn and whose edges dock on
  the outline, with one loop per hundred nodes, at 50,010 nodes. Its baselines are recorded as
  the existing ones are.

## Testing decisions

- **Engine:** Rust unit tests and property tests of each node shape's outline, inner rectangle, hit
  test, and line crossing. They include points on and beside the outline, lines from every
  direction, nodes far from the origin, and the awkward cases of the conventions. A loop's path
  stays in `f32` within the world's limit.
- **Bridge:** its property test generates the new fields, and its tests refuse an unknown node shape
  and an unknown docking.
- **Browser tests:**
  - through `comb/testing`: what the canvas draws of each node shape at each level, the hit within
    and beside the outline, outline docking with several edges on one node, the loop and its
    label, and the gesture back onto the source with loops allowed and refused;
  - in the metric tree, the existing tests unchanged, pinning that graphs without node shapes or
    docking draw as before;
  - in the UML example, the state diagram and its editing, as the class and package diagrams
    are tested.
- **Performance:** a benchmark variant with node shapes, docking, and loops, compared against its
  own baselines, Q-1 and Q-2.

## Out of scope

- Decorations other than today's arrowhead: hollow triangles, diamonds, an arrowhead at the
  source. They come with the next stage.
- Several labels on an edge, and locators at an edge's ends.
- Routers other than the cubic: orthogonal routes, bend points, routing around nodes.
- Nested nodes, layout managers for child nodes, and clipping: composite states, swimlanes, and
  system boundaries.
- Anchors on edges: a note or an association class docked on an edge.
- Node shapes the host application draws itself, icons as node shapes, and an actor's stick figure.
- Use case and activity diagrams in the UML example. Their node shapes come with this spec, their
  other needs with later ones.
- Italic or underlined text.

## ADR impact

- **New, proposed before any ticket starts** (through `propose-adr`, each in commits of ADRs
  only, for the maintainer's review):
  - **Node shapes:** the closed set of node shapes, owned by the engine. It extends the node content
    model of ADR-0013 with a node shape around the content, and the data format of ADR-0010 with the
    node shape's column.
  - **Docking on the outline:** supersedes ADR-0025. One connector per side stays the default,
    the outline is an end's alternative, and loops are allowed by an option.
  - **The benchmark's variant:** extends ADR-0028 and ADR-0029 with a second graph and its own
    baselines.
- **Binding, unchanged:**
  - ADR-0012, ADR-0018, and ADR-0027, for drawing in the existing layers and the mesh;
  - ADR-0022, for refusals;
  - ADR-0024, for the gesture, the veto, and the changes;
  - ADR-0026, for `heightOf`;
  - ADR-0030, for the layout and the example's workspace.
- **Specification:** G-13 new, G-12 amended, the assumption about connectors amended. All three
  are the maintainer's to land.
