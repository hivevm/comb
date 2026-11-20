# Ticket: The drag signal of the moving layer is written once, and no gesture imports another

## What to build

REN-moving-layer-moves-content has a gesture name the slots it drags, signal each move, and signal
its end. Four gestures write that protocol out each on their own, with a flag of their own for a
started drag:

- `nodeDrag` and `borderDrag` in `packages/comb/src/interaction/node-drag.ts`;
- the resize in `packages/comb/src/interaction/resize.ts`;
- the drag of a line between regions in `packages/comb/src/interaction/region-line.ts`.

The predicate of what a drag takes stands three times: `takenOf` in `node-drag.ts`, and inline in
`resize.ts` and in `region-line.ts`. `draggedOf` lives in `node-drag.ts`, and `resize.ts` and
`region-line.ts` import it; `resize.ts` also imports `regionBoxes` and `regionChanges` from
`region-line.ts`.

Evidence: the review of ticket 02 of uml-diagrams, finding 6: `draggedOf` reused `removalOf`
without saying so, and `resize.ts` and `region-line.ts` import it from `node-drag.ts` today. The
mutation runs of ticket 17 show what each gesture has to remember: a resize or a drag of a line
without `dragStarted` is caught by a browser test of the size per frame alone.

Let one module of `interaction` own what a drag takes and the signals of its start, its moves, and
its end. The gestures hand it their engine call and what their release records.

## Acceptance criteria

- [ ] Given the sources of `packages/comb/src/interaction/`, when a new unit test of
      `interaction.test.ts` reads them, then it fails where a module other than the one helper
      calls `dragStarted`, `dragMoved`, or `dragEnded`, watched fail on today's tree, and passes on
      the result.
- [ ] Given the gesture files, when the same test reads their imports, then it fails where one
      imports another gesture's file, watched fail on today's tree, and passes on the result.
- [ ] Given the unit tests of the drag signal in `interaction.test.ts` and the browser tests of
      `examples/metric-tree/e2e/work-per-frame.spec.ts`, `resize.spec.ts`, and `regions.spec.ts`,
      when they run, then they pass with their assertions unchanged.

## Read first

- Touches: `packages/comb/src/interaction/node-drag.ts`, `packages/comb/src/interaction/resize.ts`,
  `packages/comb/src/interaction/region-line.ts`,
  `packages/comb/src/interaction/interaction.test.ts`
- REN-moving-layer-moves-content, ARCH-graph-in-zustand-store.
- The seam: `packages/comb/src/interaction/interaction.test.ts`, and the browser tests named above.

## Blocked by

- None (can start immediately)

## Mode

unattended:

- the tests named in the criteria decide it, and the first two criteria are a unit test, watched
  fail;
- it touches `packages/comb/src/interaction/` alone, which no protected pattern covers, and a wrong
  result costs one revert;
- it touches no part the harness ADR, DEV-implementer-and-fresh-reviewer, keeps with the human,
  and fits under its cap of two open pieces of agent work;
- a wrong result shows as a red browser test of the work per frame, which counts what each frame
  uploads and queries;
- the stop: where the helper needs a change of the store's signals or of `api`, the session leaves
  its state in the hand-off and asks the human, since `api` is the maintainer's.
