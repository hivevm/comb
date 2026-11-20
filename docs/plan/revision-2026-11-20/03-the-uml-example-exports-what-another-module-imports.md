# Ticket: The UML example exports only what another module imports

## What to build

The review of the whole branch at 9b198f2f found dead exports in the UML example. Each of these is
exported and never imported by another module that is no test:

- used only in its own file: `valueNodeId` and `outerBoxesOf` in `examples/uml/src/activity.ts`,
  `depthFirst` and `Box` in `examples/uml/src/diagram.ts`, `LABEL` in
  `examples/uml/src/relationships.ts`, `dockingOf` and `STATE_SHAPES` in
  `examples/uml/src/state-diagram.ts`;
- used nowhere: `EXPANSION_MODES` and `ExpansionMode` in `examples/uml/src/shared.ts`, beside a
  `mode?:` type; `examples/uml/index.html` writes the three modes again as options;
- used by tests only: `ACTIVITY_SHAPES` in `activity.ts`, `NODE_KINDS` in `shared.ts`,
  `activityDiagram`, `notationDiagram`, and `useCaseDiagram` in their diagrams' files.

Three spec files of `examples/uml/e2e/` each declare a `type Box` of their own beside the exported
one.

Un-export what only its own file uses, write the expansion modes once, and add to
`examples/uml/src/modules.test.ts` a test that fails on an export no other module imports. A test
seam the tests import stays exported, on a list the test names with why.

## Acceptance criteria

- [ ] Given today's tree, when the new test of `modules.test.ts` runs, then it fails, naming at
      least the seven exports used only in their own files; on the result it passes.
- [ ] Given the expansion modes, when a Bun test reads the options of the mode's select in
      `examples/uml/index.html`, then they equal `EXPANSION_MODES`, or the select is filled from it,
      or the constant is gone and the test of the first criterion passes.
- [ ] Given the result, when `bun test` and the type check run in `examples/uml/`, then they pass.

## Read first

- Touches: `examples/uml/src/activity.ts`, `examples/uml/src/diagram.ts`,
  `examples/uml/src/relationships.ts`, `examples/uml/src/state-diagram.ts`,
  `examples/uml/src/shared.ts`, `examples/uml/index.html`, `examples/uml/src/modules.test.ts`
- ARCH-one-workspace-per-example.
- The golden path: the import checks already in `modules.test.ts`.
- The seam: `bun test` in `examples/uml/`.

## Blocked by

- None (can start immediately)

## Mode

unattended:

- the new test decides it, watched fail on today's tree;
- it touches the example alone and no protected part, and a wrong result costs one revert;
- it touches no part the harness ADR, DEV-implementer-and-fresh-reviewer, keeps with the human,
  and fits under its cap of two open pieces of agent work;
- a wrong result shows as a red type check or browser test;
- the stop: where ticket 01 of this revision has landed meanwhile and moved the exports, the
  session reads the list anew from the tree; where an export's use is unclear, it keeps it and
  names it in the hand-off.
