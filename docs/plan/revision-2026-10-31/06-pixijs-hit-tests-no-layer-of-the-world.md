# Ticket: PixiJS hit-tests no layer of the world

## What to build

The engine answers every hit test (ADR-0013, *Hit test*); interaction listens on the stage alone
(`packages/comb/src/interaction/index.ts:137`, `eventMode: "static"` with the screen as its hit
area), and the node views take no events (`packages/comb/src/render/nodes.ts:403`). The other
layers of the scene's `world` keep PixiJS's default, so its event system walks them on every
pointer move: a profile of a drag at the fitted view at 50,010 nodes, taken for ticket 11 of the
node-content plan (deleted in 799f006, its text in `git show 799f006^`), found PixiJS hit-testing
the edge mesh on every pointer move, 9 to 11 ms (`Mesh.containsPoint`), before the content as
well. That is a frame of Q-1's budget spent on a test whose answer nothing reads.

The scene's `world` (`packages/comb/src/render/scene.ts`) and its layers take no events of
PixiJS, so that a pointer move walks none of them; the stage keeps its events.

## Acceptance criteria

- [ ] Given the example at a size whose edges cover the canvas, when the pointer moves across it
      and drags a node, then PixiJS hit-tests no display object of the world: a browser test
      counts the calls of `containsPoint` of the edge mesh and the particles across the moves
      and asserts none.
- [ ] Given the browser tests of selection, drag, connection, label drag, hover cursor, and
      deletion, when they run, then they pass unchanged.
- [ ] Broken once: with the world's events left on, the new test counts calls and fails.

## Read first

- ADR-0013 (*Hit test*), ADR-0027; `docs/CONVENTIONS.md` (*Work a frame need not redo is pinned by
  a count*); `packages/comb/src/render/scene.ts`, `packages/comb/src/render/edges.ts`,
  `packages/comb/src/interaction/index.ts`; `examples/metric-tree/e2e/work-per-frame.spec.ts` as
  the golden path of a count.

## Blocked by

- None (can start immediately)

## Mode

unattended: a browser test decides criterion 1; the change is confined to
`packages/comb/src/render/scene.ts` and the layers it adds, no protected part, one revert undoes
it; a wrong result shows as a failing interaction test. Stop after two attempts that leave an
interaction browser test red, and write here what stands in the way.
