# Ticket: The browser tests share their page helpers

## What to build

The browser tests share helpers through `examples/metric-tree/e2e/shared.ts`, as the architecture's
test pattern says, but the editing tests copy theirs: a world-to-page point in four specs
(`connect`, `label-drag`, `delete`, `select-edge`), a `loaded` helper that loads a graph, records
`onChange`, and sets the viewport in seven, a reader of the recorded changes in three, and two
near-identical drag helpers. Some specs load through `comb.load`, others through
`window.useGraph`; with `comb.load` the example's own copy of the graph, which its sidebar reads,
silently differs from what Comb holds. `shared.ts` writes the node size again instead of importing
it from `examples/metric-tree/src/graph.ts`.

Move the point, the recorder and its reader, the drag, and `loaded` into `shared.ts`, loading
always through `useGraph`, and import the node size from the example's source.

## Acceptance criteria

- [ ] Given the specs under `examples/metric-tree/e2e/`, when they are read, then none defines a
      helper `shared.ts` holds, and each loads a graph through `useGraph`.
- [ ] Given the browser tests, when they run, then every test passes and none is removed.
- [ ] Given `shared.ts`, when it is read, then it states no node size of its own.

## Read first

- `docs/ARCHITECTURE.md` (*Test pattern*); `examples/metric-tree/e2e/shared.ts` and the specs named
  above; `examples/metric-tree/src/graph.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended: `examples/metric-tree/e2e/` is no protected part of ADR-0007. The browser tests decide
the criteria, the scope is the test helpers alone, and a wrong result costs one revert, noticed by a
red or vanished test (`scripts/sensor-tests-kept.sh` reports a removed one) and undone by the
revert. Stop: if a test's assertion has to change to pass, or after two attempts at one shared
helper, hand off with the state written here.
