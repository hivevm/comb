# Spec: UML activity, use case, and state diagrams in their full notation

## Problem

A developer who builds a modelling tool on Comb cannot draw UML 2.5.1 activity, use case, and
state diagrams in their notation. Comb has no node inside another, so there are no activity
partitions, composite states, or subjects. No node can be resized, divided into regions, or
placed on another node's border, so there are no orthogonal regions, swimlanes, pins, or entry
points. Several node shapes are missing, among them the actor, the send and accept signal
symbols, and the frame. An edge carries one label and one kind of arrowhead, and cannot end on
another edge. The UML example shows only a class, a package, and a simple state diagram.

## Solution

The host application can place nodes in containers at any depth and divide a node into regions.
It can attach border nodes, let the user resize a node, and choose among the node shapes of G-18
with dashed or no outlines and separator lines in content. It can give an edge several labels,
three kinds of arrowhead, a lightning bolt, and an end on another edge. The user drags nodes
into and out of containers, resizes nodes, drags region lines, and slides border nodes along an
outline. The UML example shows the following diagrams of Comb itself, each in the full notation
G-20 lists:

- an activity diagram of a load;
- a use case diagram of its actors;
- a full state diagram;
- a notation activity diagram for the elements the load does not hold.

## Existing behaviour

- Every node lies on the canvas. Its height comes from its content, at least 64. A node added
  last is drawn and hit on top. An edge ends at a side or the outline of a node, carries at most
  one `label`, and has `arrow` `"end"` or `"none"`. These are pinned by the tests the ADRs
  superseded on this branch cite: the engine's graph, query, hit, and stroke tests, and the
  browser tests of `examples/metric-tree/e2e/` and `examples/uml/e2e/`.
- What must stay: every metric tree test and the reference image of its edges; the benchmark's
  numbers within their margins (Q-1, Q-2); the class and package diagrams of G-12 and their
  tests; Q-3's bundle budget; Q-7's refusals.
- What moves: `EdgeData.label` gives way to `labels`. Both examples, the UML example's
  `relationships.ts` and its copy of the graph, move to the list in the ticket that changes it,
  and so does the convention *The UML example tells a relationship by its kind's family of
  colour*. A host application that keeps one label writes a list of one.

## Goals served

- G-14, G-15, G-16, G-17, G-18, G-19, G-20.
- Q-1, Q-2, Q-4, and Q-7 keep holding; Q-3's budget bounds the added code.

## User stories

1. As a developer, I want to place a node in a container node, so that a partition, a composite
   state, or a subject holds what it holds.
2. As a user, I want to drag a node into a container and out of it, so that I can restructure a
   diagram.
3. As a developer, I want to refuse a move into a container, so that my model's rules hold.
4. As a user, I want to drag a container, so that its content moves with it.
5. As a user, I want to delete a container, so that its content goes with it.
6. As a user, I want to resize a node by its handles, so that a partition or a composite state
   fits what it holds.
7. As a developer, I want to divide a node into named regions, side by side or stacked and nested,
   so that I can draw swimlanes and orthogonal regions.
8. As a user, I want to drag the line between two regions, so that I can share the space anew.
9. As a developer, I want to attach a node to another's border, so that pins, parameter nodes,
   and entry and exit points sit on their owner.
10. As a user, I want to slide a border node along its owner's outline, so that I can tidy edges.
11. As a developer, I want the node shapes of UML's activity, use case, and state diagrams, so
    that a reader recognises each element by its node shape.
12. As a developer, I want dashed and invisible outlines, so that interruptible and expansion
    regions and free text look as UML draws them.
13. As a developer, I want a line between rows of content, so that a state's name stands apart
    from its behaviours.
14. As a developer, I want several labels on an edge, so that an association shows a multiplicity
    and a role at each end.
15. As a developer, I want open and hollow arrowheads, so that flows, transitions, includes,
    extends, and generalizations look as UML draws them.
16. As a developer, I want an edge to end on another edge, so that a comment or an extend's
    condition is anchored on a relationship.
17. As a developer, I want a lightning bolt edge, so that interrupting edges and exception
    handlers look as UML draws them.
18. As a developer evaluating Comb, I want the UML example to show these diagrams of Comb itself,
    so that I see every element at work: an activity diagram of a load, a use case diagram of its
    actors, a full state diagram, and a notation diagram.

## Implementation decisions

- The ten proposed ADRs of this branch decide the engine, the scene, the moving layer, the hit
  test, the graph data, and the public interface:
  - ARCH-engine-edits-nested-graph;
  - REN-virtualized-nested-scene;
  - REN-moving-layer-moves-content;
  - ARCH-regions-are-container-slots;
  - ARCH-border-nodes-ride-sides;
  - REN-node-shapes-cover-uml;
  - REN-node-content-and-hits;
  - API-edges-dock-nodes-or-edges;
  - API-edits-report-nested-changes;
  - API-bridge-columns-carry-nesting.

  The tickets implement them while they are proposed. The human accepts an ADR in the change
  whose tests complete its Enforcement. Each restatement flips its predecessor to superseded and
  moves that predecessor's citations to it in the same change.
- The activity diagram of the UML example shows a load from `createComb` to the first frame, in
  partitions for the host application, the shell, and the engine. It holds the veto as a decision
  and an interruptible region for the loss of the engine. The use case diagram shows the
  developer, the user, and the host application as actors, with the use cases of G-1 to G-17.
  Notation elements that do not fit either content are shown in a notation activity diagram. The
  human chose this on 2026-11-17.
- A value pin's value, a pin's name, and `{stream}` beside a pin are further border nodes with an
  outline of `"none"`. A parameter set is a border node with a dashed outline around its pins. A
  ticket that finds this too weak hands off for an ADR instead.
- Each diagram's rules of connection join the table of refusals in `examples/uml/src/rules.ts`,
  as the convention *The UML example's rules of connection are a table of what they refuse* says.

## Testing decisions

- Engine: unit and property tests in `crates/engine/src/graph/tests.rs`,
  `crates/engine/src/graph/hit.rs`, and the geometry tests of `crates/engine/src/shape.rs` and
  `crates/engine/src/geometry.rs`. They copy the property tests of edits against a scan.
- Bridge: the property test of the bridge crate in `crates/engine-wasm/src/properties.rs`, for every
  new field and refusal.
- Shell: browser tests through `comb/testing`, inspection, and the counters of `work`. They copy
  `examples/metric-tree/e2e/drag.spec.ts`, `examples/metric-tree/e2e/work-per-frame.spec.ts`, and
  `examples/uml/e2e/state-edit.spec.ts`.
- The UML example: its unit tests under `examples/uml/src/` and its browser tests under
  `examples/uml/e2e/`, one per diagram, as for the class and the state diagram.

## Out of scope

- Two-dimensional partitions, since a node is divided one way only.
- Selecting a region on its own.
- A user's connection that ends on an edge; only the host application makes one.
- Chains of edges on edges.
- The other UML diagrams: class beyond G-12, sequence, communication, timing, interaction
  overview, component, deployment, and composite structure.
- Undo, multiple selection, and automatic layout.

## ADR impact

The ten proposed ADRs above bind this work. The accepted ADRs that bind its paths, as
`scripts/sensor-binding-adrs.sh` lists them per ticket, keep binding, among them
ARCH-graph-in-zustand-store, API-host-asks-content-height, REN-webgl2-or-canvas-fallback,
SEC-pixijs-without-eval, and ARCH-one-workspace-per-example, as do the `NUC-` ADRs. No further
ADR is needed before the tracer bullet. Ticket 07 checks whether REN-webgl2-or-canvas-fallback
has to say how the Canvas 2D fallback draws the new node shapes and outlines, and hands off for
an ADR if it does.
