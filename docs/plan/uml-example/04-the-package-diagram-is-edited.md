# Ticket: The package diagram is edited, and no connection crosses the diagrams' kinds

## What to build

The package diagram becomes editable as the class diagram is. The palette, while the package
diagram is shown, offers a package. Selecting a package lets the sidebar change its name;
selecting a dependency lets it choose «import» or «use». A connection between two packages adds
a dependency «use». The rules of connection refuse a dependency of a package on itself. Each
diagram keeps its edits while the other is shown.

## Acceptance criteria

- [ ] Given the package diagram, when the user drops a package from the palette, then a node with
  the caption «package» and a default name appears under the pointer (G-12, G-1).
- [ ] Given two packages, when the user connects them, then a dashed dependency with an arrowhead
  and the label «use» is added; when the user chooses «import» in the sidebar, then its label
  reads «import» (G-12, G-3, G-11).
- [ ] Given a package, when the user drags a connection from it back to itself, then the veto
  refuses it and no edge is added.
- [ ] Given edits on both diagrams, when the user switches from one to the other and back, then
  each shows its own edits.
- [ ] Given the rules of connection, when `bun test` runs them, then the cases of packages match
  the table in the conventions.

## Read first

- Touches: `examples/uml/`, `docs/CONVENTIONS.md`
- The spec next to this ticket.
- Glossary: *Palette*, *Sidebar*, *Connection*, *Veto*.
- Golden path: the class diagram's editing of ticket 03 and its tests.

## Blocked by

- docs/plan/uml-example/02-the-package-diagram-of-combs-modules.md
- docs/plan/uml-example/03-the-class-diagram-is-edited.md

## Mode

unattended:
- a test decides its criteria: the browser tests and the `bun test` of the rules above;
- its scope is `examples/uml/` and the conventions' table of rules, and a wrong result costs one
  revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing test or in the maintainer's look at the example; the tests and
  `scripts/check-all.sh` green prove it right;
- stop: when `scripts/check-all.sh` is still red after three attempts at a fix, or the work needs
  a change to the class diagram's editing beyond what ticket 03 left, the session leaves its state
  here and hands off.
