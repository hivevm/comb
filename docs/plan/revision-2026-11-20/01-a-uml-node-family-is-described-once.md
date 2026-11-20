# Ticket: A UML node family is described once, and the generic modules import no diagram

## What to build

The UML example knows four families of node: classifiers, states, activity nodes, and use case
nodes. The notation diagram reuses the activity family. The example writes the difference between
the families out in its generic modules rather than in a descriptor each family exports:

- `examples/uml/src/diagram.ts` imports `contentOf` from `state-diagram.ts` and from
  `use-case-diagram.ts`, keeps one map per family, chains them in `kindOf`, edits each by a method
  of its own (`edit`, `editState`, `editActivity`, `editUseCase`), and lists the four maps again in
  `mirror`, `removed`, and `deletable`;
- `examples/uml/src/shared.ts` gives `DiagramData` one map per family;
- `examples/uml/src/sidebar.ts` fills and edits a node by one branch per family (`fillNode`,
  `editNode`);
- `examples/uml/src/main.ts` imports each family's internals (`newState`, `nodesOf`,
  `newUseCaseNode`, `USE_CASE_SHAPES`, `newActivityNode`, `ACTIVITY_BORDERS`, among others),
  branches four ways in `droppedOf`, and lists the four maps twice in `keep`.

Each family writes the same shape again: a `contentOf`, a `nameOf`, a `nodesOf`, a constructor,
and a table of border nodes. The overview says that `src/diagram.ts` and `src/sidebar.ts` read the
descriptor of the diagram shown instead of branching on a kind; for the families of node they
branch. `examples/uml/src/modules.test.ts` holds only `shared.ts` and `activity.ts`, so nothing
stops `diagram.ts` from importing a diagram.

Evidence: ticket 01 of the revision of 2026-11-18 asked for this with two families and was not
worked before tickets 11 to 16 of uml-diagrams landed, as its *Mode* advised. What it predicted
followed: each family's commit changed the generic modules (d9e2913b: `diagram.ts` +241/−32,
`sidebar.ts` +154/−38; 568585f2: `diagram.ts` +98/−50, `sidebar.ts` +100/−37, `shared.ts` +135;
4c82f4c7: `diagram.ts` +97/−21, `sidebar.ts` +82/−21; 18276000: `diagram.ts` +135/−36, `main.ts`
+81/−28; 9b198f2f: `sidebar.ts` +72/−20, `main.ts` +45/−10). The review of the whole branch at
9b198f2f named the four families branched in these modules. This ticket supersedes ticket 01 of
the revision of 2026-11-18, which this revision deletes.

Let each family be described once, as the diagrams are. The description says which kinds the
family holds, what creates a node of a kind, what its content and its name are, how its nodes are
laid out from a record, which kinds own border nodes, and whether a node lands outside its
container. The diagram, the sidebar, and the host read it rather than branch on it. Keep the
behaviour of each diagram as the browser tests of `examples/uml/e2e/` pin it.

## Acceptance criteria

- [ ] Given the UML example's sources, when `modules.test.ts` runs, then it fails where
      `diagram.ts` or `sidebar.ts` imports a diagram's file or a family's file, or where `main.ts`
      imports anything but a diagram's descriptor from one, and it passes on the result.
- [ ] Given a stand-in family in a stand-in diagram descriptor, when a Bun test drops, edits, and
      deletes a node of it through `Diagram`, then it passes with no branch on that family in
      `diagram.ts`, `sidebar.ts`, or `main.ts`.
- [ ] Given a node of each family on its diagram, when the user edits it in the sidebar, then it
      keeps its family and its kind, and the browser tests of `examples/uml/e2e/` pass with the
      count of tests unchanged.
- [ ] Given the overview's part of the UML example, when it is read against the code, then it says
      what the descriptor of a family holds.

## Read first

- Touches: `examples/uml/src/diagram.ts`, `examples/uml/src/sidebar.ts`, `examples/uml/src/main.ts`,
  `examples/uml/src/shared.ts`, `examples/uml/src/state-diagram.ts`, `examples/uml/src/activity.ts`,
  `examples/uml/src/use-case-diagram.ts`, `examples/uml/src/modules.test.ts`
- ARCH-one-workspace-per-example, API-export-apply-change; the **UML example** part of
  `docs/ARCHITECTURE.md`.
- The golden path: the descriptor of a diagram (`DiagramDescriptor` in `shared.ts`), and fe0bb5e8,
  which moved each diagram into it.
- The seam: Bun tests beside the modules, and `examples/uml/e2e/`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the shape of a family's descriptor is a choice every later diagram builds on, so
the maintainer judges it before the implementation.
