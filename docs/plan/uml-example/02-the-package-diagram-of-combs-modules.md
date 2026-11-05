# Ticket: The package diagram of Comb's modules

## What to build

The sidebar's choice of diagram gains the package diagram. Choosing it shows Comb's modules
(`api`, `bridge`, `store`, `interaction`, `render`) and crates (`engine`, `engine-wasm`) as nodes
with the stereotype «package» and their name, and each dependency the structural rules of the
layout ADR allow as a dashed edge with an arrowhead and the label «import» or «use». Choosing the
class diagram again shows it as it was. Viewing only.

## Acceptance criteria

- [ ] Given the UML example on its class diagram, when the user chooses the package diagram,
  then the canvas shows only the package diagram's nodes and edges, each package with the caption
  «package» and its name as title (G-12).
- [ ] Given the package diagram, when its edges are drawn, then each is dashed, has an arrowhead
  at its target, and carries the label «import» or «use» (G-12, G-11).
- [ ] Given the package diagram, when the user chooses the class diagram again, then the class
  diagram is shown with the same nodes and edges as before.

## Read first

- Touches: `examples/uml/`
- The spec next to this ticket.
- Glossary: *Node content*, *Dash pattern*, *Edge label*, *Selection*.
- Golden path: the class diagram of ticket 01 and its browser tests.

## Blocked by

- docs/plan/uml-example/01-the-class-diagram-opens-from-vs-code.md

## Mode

unattended:
- a test decides its criteria: the browser tests above, through the hooks ticket 01 sets up;
- its scope is `examples/uml/` alone, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing browser test or in the maintainer's look at the example;
  the browser tests and `scripts/check-all.sh` green prove it right;
- stop: when `scripts/check-all.sh` is still red after three attempts at a fix, or the diagram
  needs anything of Comb beyond its public interface, the session leaves its state here and hands
  off.
