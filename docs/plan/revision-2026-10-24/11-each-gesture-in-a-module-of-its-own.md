# Ticket: Each gesture lives in a module of its own

## What to build

`packages/comb/src/interaction/index.ts` holds the node drag, the label drag, the connection, and
the pan as one `Drag` union that six functions switch on by kind (`startDrag`, `continueDrag`,
`endDrag`, `endLabelDrag`, `takenFrom`, `tellEnd`) and the cursor line. Ending a gesture whose
subject the graph took away is a rule per kind, written in `takenFrom` and again in the store for
the connection (`store/index.ts`, its removals and its load), so the connection has two sources of
truth, the local drag and `store.connection`. Three review findings of the editing work were a
gesture that did not end where its subject went (a label the host cleared, a connection a later
press ended, a node removed under a connection). The guard that swallows `EngineLostError` in
input handlers is written in `index.ts` (`untilLost`) and again by hand in `delete.ts`. The
module's header still names only the drag, the pan, and the zoom.

Give each gesture an object of its own, in a module of its own, that says how it moves, how it
ends at a release or at a later press, and whether a change of the graph takes its subject; keep
`index.ts` to dispatching. Keep the connection's state in one place. Share the guard. Behaviour
stays as it is.

## Acceptance criteria

- [ ] Given the interaction unit tests and the browser tests of drag, connect, label drag, delete,
      and select-edge, when they run, then they pass unchanged.
- [ ] Given a gesture, when a load or a removal takes its subject, then one function of that
      gesture decides it, and no other module repeats the rule.
- [ ] Given a connection being dragged, when anything reads where it is, then it reads one state.
- [ ] Given `delete.ts`, when it handles a key, then it uses the shared guard.

## Read first

- ADR-0023 (*Delivery*, *Vetoes*), ADR-0025 (*What a press does*), ADR-0024 (*Compatible*),
  ADR-0011.
- `packages/comb/src/interaction/index.ts`, `connect.ts`, `delete.ts`, `interaction.test.ts`;
  `packages/comb/src/store/index.ts` (`connection`, the removals).
- Blocks nothing, but ticket 12 of this directory changes where the connection's point lives;
  work them in either order, not in parallel.

## Blocked by

- None (can start immediately)

## Mode

unattended: `packages/comb/src/interaction/` and `store/` are no protected part of ADR-0007. The
existing suites decide the criteria (interaction unit tests, the browser tests named above); the
scope is `interaction/` and the connection's state in `store/`, and a wrong result costs one
revert, noticed by a red suite and undone by the revert. Stop: if a test has to change to pass,
or after two attempts at one state for the connection, hand off with the state written here.
