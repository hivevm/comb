# Ticket: The UML example writes each label, style, and edit once

## What to build

The state diagram's ticket 04 (merge 1187802) named lesser review findings in `examples/uml/src/`,
and the design revision of 2026-11-07 found more beside them. None is covered by
docs/plan/revision-2026-11-06/03-a-uml-node-keeps-its-kind-and-the-diagrams-share-one-module.md:

- **A label is built in three places:** `styleOf` in `examples/uml/src/relationships.ts`,
  `Sidebar.changeLabel` in `examples/uml/src/sidebar.ts` by hand, and `eventLabel` in
  `examples/uml/src/state-diagram.ts`. One function builds a label of a kind, its text, and the
  place it already has, and the other two call it.
- **The transition's style is written twice:** `edgeOf` in `examples/uml/src/state-diagram.ts`
  sets the colour and arrowhead that `RELATIONSHIPS.transition` holds; it spreads `styleOf`.
- **`edit` and `editState` in `examples/uml/src/diagram.ts` are one try and catch written twice;**
  one private function updates a node's content, and `rekind` gets the same guard.
- **The kinds of relationship are listed three times:** the `RelationshipKind` union, the
  `RELATIONSHIPS` table, and `KINDS` in `examples/uml/src/relationships.ts`. The union and `KINDS`
  follow from the table.
- **The hidden kind select is set to `transition`,** a value it has no option for
  (`examples/uml/src/sidebar.ts`); it is set only where the form edits a relationship.
- **`dockingOf`'s `sourceSide ?? "right"`** in `examples/uml/src/state-diagram.ts` is a fallback no
  change reaches, since `edgeAdded` always carries `sourceSide`; it goes.
- **`droppedOf` in `examples/uml/src/main.ts`** returns a node and a closure where `drop` can branch
  on the kind after `addNode` returned; the closure goes.

## Acceptance criteria

- [ ] Given `examples/uml/src/`, when it is searched, then one function builds an edge's label and
      one table lists the kinds of relationship, from which the union and the legend's list
      follow.
- [ ] Given the class, package, and state diagrams, when the UML browser tests run, then they pass
      with their assertions unchanged, `examples/uml/e2e/state-edit.spec.ts` among them.
- [ ] Given a selected transition, when the sidebar shows it, then the kind select is not set to a
      value it has no option for, as a unit or browser test decides.

## Read first

- Touches: `examples/uml/src/relationships.ts`, `examples/uml/src/sidebar.ts`,
  `examples/uml/src/state-diagram.ts`, `examples/uml/src/diagram.ts`, `examples/uml/src/main.ts`
- The merge message of 1187802, *Lesser review findings*.
- The UML example's entry of `docs/ARCHITECTURE.md`; the conventions *The UML example tells a
  relationship by its kind's family of colour* and *A host application's copy follows what Comb
  took*.

## Blocked by

- docs/plan/revision-2026-11-07/07-each-uml-diagram-is-described-in-one-place.md: its descriptor
  reshapes the files this ticket writes once.

## Mode

unattended:
- a test decides its criteria: the UML browser tests, unchanged, the unit tests, and the build;
- its scope is `examples/uml/src/`, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing browser test or a label drawn other than before;
  `scripts/check-all.sh` green proves it right;
- stop: when a browser test's assertion has to change, or `scripts/check-all.sh` is still red
  after three attempts at a fix, the session leaves its state here and hands off. It does not run
  beside
  docs/plan/revision-2026-11-06/03-a-uml-node-keeps-its-kind-and-the-diagrams-share-one-module.md,
  which touches the same files.
