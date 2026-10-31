# Ticket: The bridge's column writers in a module of their own

## What to build

`packages/comb/src/bridge/index.ts` is 1,403 lines and holds two concepts: the writers of a
load's columns (ADR-0034, *Graph data of a load*), lines 77–826, `ContentColumns`,
`NodeColumns`, `NodeColumnWriter`, `stringColumn`, the codes of kinds, roles, directions,
arrowheads, and sides, `nodeColumns`, `EdgeColumns`, `EdgeColumnWriter`, and `edgeColumns`; and
the facade of the engine, lines 826–1403, the `Bridge`, the guard of a lost engine (ADR-0021),
the test-mode seams, `load`, which hands the columns over as parameters, and `queried`. A reader of
the facade reads past 750 lines of writing, and a column added later lands among the guard and
the views.

The writers move to `packages/comb/src/bridge/columns.ts`, re-exported from
`packages/comb/src/bridge/index.ts` as now, with their tests beside them, the way the node-content
revision splits the bridge crate's `graph_data`; behaviour unchanged.

## Acceptance criteria

- [ ] Given `packages/comb/src/bridge/`, when the move lands, then `columns.ts` holds the column
      writers and their types, `index.ts` the facade, and no import outside the bridge changes.
- [ ] Given the bridge's Bun tests, the type test `packages/comb/src/bridge/snapshot-only.test.ts`,
      and the malformed-data browser tests, when they run, then they pass with the same tests,
      moved, none removed.
- [ ] Given `scripts/check-structure.sh` and `scripts/check-bundle.sh`, when they run, then they
      pass, the bundle's size within a few bytes of before.
- [ ] Given `docs/ARCHITECTURE.md`, when the move lands, then the bridge's entry names
      `columns.ts`.

## Read first

- ADR-0034, ADR-0028; the overview's **Bridge** entry;
  docs/plan/revision-2026-10-31/01-the-snapshot-reads-host-content-in-one-walk.md, which reshapes
  `NodeColumnWriter`.

## Blocked by

- docs/plan/revision-2026-10-31/01-the-snapshot-reads-host-content-in-one-walk.md

## Mode

with the human: `packages/comb/src/bridge/` is a protected part of ADR-0007.
