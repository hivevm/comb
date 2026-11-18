# Ticket: A family of UML nodes is described once, and the diagram imports no diagram

## What to build

The UML example knows two families of node, classifiers and states, and writes the difference out in
the host's modules rather than in the descriptor each diagram exports:

- `examples/uml/src/diagram.ts` keeps a map for each family (`classifiers`, `states`), decides a
  node's family in `kindOf`, edits each by a method of its own (`edit`, `editState`), and imports
  `contentOf` from `state-diagram.ts`, so the generic diagram depends on one diagram's file;
- `examples/uml/src/sidebar.ts` fills and edits a node by one branch per family (`fillNode`,
  `editNode`);
- `examples/uml/src/main.ts` imports `newState`, `STATE_SHAPES`, and the state's `contentOf`, and
  branches on `CLASSIFIER_KINDS` and `STATE_KINDS` where a node is dropped and where it merges the
  kinds of node.

The overview says that `src/diagram.ts` and `src/sidebar.ts` read the descriptor of the diagram
shown instead of branching on a kind; for the families of node they branch. `modules.test.ts`
holds only the diagrams' files and `shared.ts`, so nothing stops `diagram.ts` from importing a
diagram.

Evidence: the area was reworked four times in a row on 2026-11-07 (5d693a99: an edit of the
stereotype turned a class into a package through `kindOf`; fe0bb5e8: the descriptor; 60b76e84: the
stand-in object of `fillNode`; 8863bd4e: the kinds out of the rules). The tickets 11 to 14 of
`docs/plan/uml-diagrams/` add the activity's, the use case's, and the notation's families, each of
which would add a map, an edit method, and a branch in three modules.

Let each family of node be described once, as the diagrams are: what creates a node of the family,
what its content is, and its shapes, so that the diagram, the sidebar, and the host read it rather
than branch on it. Keep the behaviour of each diagram as the browser tests of `examples/uml/e2e/`
pin it.

## Acceptance criteria

- [ ] Given the UML example's sources, when `modules.test.ts` runs, then it fails where
      `diagram.ts`, `sidebar.ts`, or `main.ts` imports a diagram's file, and passes on the result.
- [ ] Given a node of each family on its diagram, when the user edits its name and its stereotype or
      its kind in the sidebar, then it keeps its family and its kind, as the browser tests of the
      example check today, and they pass unchanged.
- [ ] Given a new family of node described in one diagram's file, when the example registers it,
      then no branch on a family is added to `diagram.ts`, `sidebar.ts`, or `main.ts`; a Bun test of
      a stand-in family shows it.
- [ ] Given the overview's part of the UML example, when it is read against the code, then it says
      what the descriptor of a family holds.

## Read first

- Touches: `examples/uml/src/diagram.ts`, `examples/uml/src/sidebar.ts`, `examples/uml/src/main.ts`,
  `examples/uml/src/shared.ts`, `examples/uml/src/state-diagram.ts`,
  `examples/uml/src/modules.test.ts`
- ARCH-one-workspace-per-example, API-export-apply-change; the **UML example** part of
  `docs/ARCHITECTURE.md`.
- The golden path: the descriptor of a diagram (`DiagramDescriptor` in `shared.ts`), and fe0bb5e8,
  which moved each diagram into it.
- The seam: Bun tests beside the modules, and `examples/uml/e2e/`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the shape of the descriptor is a choice the tickets 11 to 14 of
`docs/plan/uml-diagrams/` build on, so the maintainer judges it before they start; the work best
lands before the first of them.
