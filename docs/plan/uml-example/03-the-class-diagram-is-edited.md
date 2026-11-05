# Ticket: The class diagram is edited from the palette and the sidebar

## What to build

The class diagram becomes editable as the metric tree is. The palette offers a class, an
interface, and an abstract class, dropped where the pointer lets go. Selecting a class fills the
sidebar with its name, stereotype, attributes, and operations, one per line, and each edit shows
on the canvas at once, the node's height following. A connection between two classes adds an
association; selecting a relationship lets the sidebar change its kind, among those the
conventions record, and its label. The selected node or relationship can be deleted. The rules
of connection refuse a generalization or a realization of a class by itself, through the veto;
the sidebar refuses the change of kind that would make one.

## Acceptance criteria

- [ ] Given the class diagram, when the user drops an interface from the palette, then a node
  with the caption «interface» and a default name appears under the pointer (G-12, G-1).
- [ ] Given a selected class, when the user adds an operation in the sidebar, then the node shows
  it as a row and grows by its height (G-12, G-5).
- [ ] Given two classes, when the user connects them, then an association is added; when the user
  changes its kind to generalization in the sidebar, then the edge is drawn as the conventions
  record for a generalization (G-12, G-3).
- [ ] Given an edge from a class to itself, when the user changes its kind to generalization or
  realization, then the sidebar refuses it and the edge keeps its kind.
- [ ] Given the rules of connection, when `bun test` runs them over every pair of node kinds and
  every relationship kind, then each answer matches the table in the conventions.
- [ ] Given a selected class with relationships, when the user deletes it, then it and its
  relationships are removed (G-4).

## Read first

- Touches: `examples/uml/`, `package.json` (the test script, for the rules under `bun test`),
  `docs/CONVENTIONS.md`
- The spec next to this ticket.
- Glossary: *Palette*, *Sidebar*, *Connection*, *Veto*, *Change*, *Selection*.
- Golden path: the palette, the sidebar, and the veto of `examples/metric-tree/src/main.ts`; its
  browser tests `palette.spec.ts`, `connect.spec.ts`, and `delete.spec.ts`.

## Blocked by

- docs/plan/uml-example/01-the-class-diagram-opens-from-vs-code.md

## Mode

with the human: how the sidebar edits members and how a refused change of kind shows are
judgements of the user's side the maintainer wants to see before they settle.
