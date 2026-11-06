# Spec: The UML example, with a class diagram and a flat package diagram

<!-- The destination of a piece of work larger than one agent session; its tickets lie next to it.
     Disposable: the design revision deletes it once its tickets have merged. Decided in
     docs/adr/0006-feature-layer.md. -->

## Problem

A developer who weighs Comb sees one example, a metric tree. Whether Comb carries the diagrams
developers draw most, UML diagrams among them, they cannot tell without building one. The
maintainer wants Comb to cover, in the end, class, use case, activity, state, and package
diagrams; most of them need capabilities Comb does not have yet (shapes of nodes, kinds of
arrowhead, several labels on an edge, nodes inside nodes). Two of them can be drawn with what
Comb offers today, and nobody has shown it.

## Solution

The developer starts a second launch configuration, *Example: UML*, and a second example host
application opens in the browser. Its sidebar switches between two diagrams of Comb itself:

- a **class diagram** of Comb's public interface: each class or interface a node whose content
  shows its stereotype, its name, its attributes, and its operations, one row each; each
  relationship an edge whose colour, dash pattern, arrowhead, and label tell its kind;
- a **flat package diagram** of Comb's modules and crates: each package a node with the
  stereotype «package» and its name, each dependency a dashed edge with an arrowhead and the
  label «import» or «use».

The user edits both as in the metric tree: drops a class, an interface, or a package from the
palette, connects two nodes, which adds a relationship of a default kind, changes the kind, the
name, and the members in the sidebar, and deletes what is selected. The example refuses a
connection UML does not allow.

## Existing behaviour

Greenfield for the example itself; nothing in Comb changes. What must stay is the example of G-9
and everything that measures it: its launch configuration, `bun run example`, its browser tests,
and the benchmark, which builds and loads the metric tree alone. The browser tests of the metric
tree and the benchmark's own tests pin that; they run unchanged after every ticket.

The layout of the repository names one example
([ADR-0009](../../adr/0009-functional-core-imperative-shell.md)). The proposed
ADR-0030 restates it with one workspace for each example.

## Goals served

- **G-12** (new, drafted here; the maintainer lands it in the specification,
  [`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7).
  Proposed text, after G-11:

  > **G-12** — When the developer starts the launch configuration *Example: UML* in VS Code, the
  > system shall build the engine, serve a second example host application, and open it in the
  > browser. Its sidebar switches between two UML diagrams of Comb itself. A class diagram of
  > Comb's public interface shows each class or interface as a node with its stereotype, its name,
  > its attributes, and its operations, and each relationship as an edge whose colour, dash
  > pattern, arrowhead, and label tell its kind. A package diagram of Comb's modules and crates
  > shows each package as a node with the stereotype «package» and its name, and each dependency
  > as a dashed edge with an arrowhead and the label «import» or «use». A palette adds classes,
  > interfaces, and packages; a connection adds a relationship, which the example refuses where
  > UML does not allow it; and the sidebar edits the selected node or edge.

- It uses, and so shows in a second host application, G-1 to G-5, G-10, and G-11.

## User stories

1. As a developer weighing Comb, I want to start a UML example from VS Code, so that I can see
   whether Comb carries diagrams other than the metric tree.
2. As a developer, I want to switch between a class diagram and a package diagram in one example,
   so that I compare them without restarting.
3. As a user of the example, I want each class to show its stereotype, name, attributes, and
   operations in rows, so that it reads as a UML class.
4. As a user, I want each kind of relationship drawn distinctly, so that I tell an association
   from a generalization, a realization, or a dependency at a glance.
5. As a user, I want a legend in the sidebar that names the kind each colour and dash pattern
   stands for, so that I can read what the canvas cannot yet draw in UML's own notation.
6. As a user, I want to drop a class, an interface, or a package from the palette, so that I can
   extend a diagram.
7. As a user, I want a new connection to become a relationship of a default kind, which I change
   in the sidebar, so that connecting stays one gesture.
8. As a user, I want the example to refuse a connection UML does not allow, a generalization of
   a class by itself or a dependency between a class and a package, so that the diagram stays
   valid.
9. As a user, I want to edit the name, the stereotype, the attributes, and the operations of the
   selected class in the sidebar, so that the canvas shows them at once.
10. As a user, I want to delete the selected node or relationship, so that I can correct a
    diagram.
11. As the maintainer, I want the UML example to grow with each later diagram type, so that each
    new capability of Comb is shown where it is needed.

## Implementation decisions

- A second example host application, of its own workspace beside the metric tree, imports Comb
  only by its entries, as the metric tree does, and imports nothing of the metric tree.
- Its sidebar holds a choice between the diagrams; choosing one loads that diagram's graph data.
  Each diagram keeps its own edits while the other is shown, for as long as the page lives; the
  example stores nothing (the Non-Goals and Threats of the specification).
- Node content uses only the content elements that exist: a caption for the stereotype
  («interface», «abstract», «package»), a title for the name, and a body text for each attribute
  and each operation, the visibility (`+`, `-`, `#`, `~`) part of its text. An abstract class or
  member and a static member carry `{abstract}` or `{static}` in their text, since Comb has no
  italic or underlined text.
- Relationship kinds of the class diagram: association, directed association, generalization,
  realization, dependency, aggregation, and composition. Each is told by colour, dash pattern,
  arrowhead (end or none), and, where the first three cannot tell it, its label. The legend in
  the sidebar lists them. The exact mapping is settled with the maintainer in the ticket that
  draws the class diagram, and the conventions record it.
- Package dependencies are dashed, with an arrowhead and the label «import» or «use».
- The connect gesture adds an association between classes and a dependency «use» between
  packages; the veto refuses a connection between a class and a package, and a generalization or
  realization of a node by itself, once the kind is changed to one. The rules are a pure function
  of the example, `(source kind, target kind, relationship kind) → allowed`.
- Nodes are placed by the example from the heights Comb gives (`heightOf`, ADR-0026), in layers
  laid out by hand in the diagram's data; no automatic layout.
- The structure overview and the glossary gain the UML example; the build, the browser tests,
  and the checks build and test both examples.

## Testing decisions

- Browser tests of the UML example, through the window hooks the metric tree's tests use and the
  functions of `comb/testing`: what the canvas draws of each diagram, the switch between them, the
  palette, the connection with its veto, the sidebar's edits, and the deletion. The metric tree's
  browser tests (its example, connect, and palette tests) are the prior art.
- The rules of connection, a pure function, under `bun test`.
- The structural check of ADR-0009 and its successor gains the case of one example importing
  another, with a self-test, as the check's other cases have.
- The metric tree's browser tests and the benchmark run unchanged; they decide that nothing of G-9
  moved.

## Out of scope

- Use case, activity, state, object, communication, and other diagrams; they follow in later
  specs as Comb gains the capabilities they need.
- Any change to Comb's library or engine: shapes of nodes, kinds of arrowhead, arrowheads at the
  source, several labels on an edge, dividers between compartments, italic or underlined text,
  several connectors on a side, and nodes inside nodes. The example shows what is missing; it
  does not work around it in Comb.
- Nested packages and classes inside packages.
- Automatic layout, import or export of diagrams, and storage.
- A benchmark of the UML example; the metric tree stays the example the benchmark measures.

## ADR impact

- Binding: [ADR-0009](../../adr/0009-functional-core-imperative-shell.md) names the metric tree as
  the one example of the layout. **ADR-0030** (proposed on this branch)
  restates it with one workspace for each example the specification asks for. No ticket starts
  before the maintainer has reviewed it and landed G-12. Its acceptance moves every
  `Verifies: ADR-0009` marker to its number.
- Binding, unchanged: [ADR-0008](../../adr/0008-toolchain.md) for the build, the browser tests, and
  the scripts; [ADR-0014](../../adr/0014-dev-container-toolchain.md) for the launch configuration;
  [ADR-0019](../../adr/0019-the-host-hands-comb-its-engine.md) and
  [ADR-0020](../../adr/0020-pixijs-without-eval.md) for how a host application creates Comb;
  [ADR-0024](../../adr/0024-edits-are-reported-as-typed-changes.md) for the veto and the changes;
  [ADR-0025](../../adr/0025-one-connector-per-side.md) for the sides of edges;
  [ADR-0026](../../adr/0026-the-host-asks-the-height-content-lays-out-to.md) for placing nodes by
  their height.
- No other new ADR: the example builds on the public interface as it stands.
