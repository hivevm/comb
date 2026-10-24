# Ticket: Every edit runs through one pipeline in `api`

## What to build

Each method of `Comb` that changes the graph (`load`, `updateNode`, `addNode`, `addEdge`,
`updateEdge`, `removeNodes`, `removeEdges`) writes out the same steps by hand in
`packages/comb/src/api/index.ts`: refuse once the engine is lost, read the input once into a
snapshot, refuse what the store's map shows (ADR-0028), check the identifier budget, hand the
snapshot to the bridge, and have the store take the result and record the change (ADR-0023). The
order, the input read before the map is asked, is what Q-7 rests on, and it stands only as two
copied comments; two editors already had it wrong until review (`updateEdge`, `updateNode`). The
removals call the bridge outside `checked()`, which every other editor uses. The user's deletion
(`interaction/delete.ts`) is a second removal path straight to the bridge and the store, while
the user's connection goes through `api`'s adder. `by` is an optional parameter of the store's
actions that defaults to `"host"`, so a forgotten argument reports the user's edit as the host's.
The code units of identifiers are counted in `api/snapshot.ts`, again from scratch by the store on
a load, and by a formula written three times in `store/index.ts`.

Give the editors one home (`api/editors.ts` or the like) built on one function that owns the order
and the wrapping; hand interaction a remover from it as it hands the connection an adder; make
`by` a required argument wherever it varies; count the code units of a node and of an edge in one
function each, and let `load` take the count the snapshot already made. `api/index.ts` keeps the
public types, the errors, and `createComb`'s wiring. Interface-preserving: no method of `Comb`
changes what it accepts, returns, throws, or tells.

## Acceptance criteria

- [ ] Given every method that changes the graph, when it is called with an input whose getter
      edits the graph through `Comb`, then the edit is refused or applied as if the getter's edit
      had come first, and the store and the engine agree after it (`Verifies: Q-7`).
- [ ] Given the user's deletion and `removeNodes` of the same node, when each runs, then both go
      through the one removal function and tell the same change but for `by`.
- [ ] Given a store action that records a change, when it is called without `by`, then the type
      checker refuses the call.
- [ ] Given a load, when the store takes it, then it counts no identifier the snapshot counted.
- [ ] Given the browser tests, the Bun tests, and the type test of `GraphChange`, when they run,
      then they pass unchanged.
- [ ] Broken once: with the input read after the map is asked in the one function, the first
      criterion's test fails.

## Read first

- ADR-0023 (*Validation*, *Delivery*), ADR-0028 (*What the bridge cannot see*), ADR-0011, ADR-0021.
- `packages/comb/src/api/index.ts`, `api/snapshot.ts`, `store/index.ts`,
  `interaction/delete.ts`, `interaction/connect.ts`; `docs/CONVENTIONS.md` (*Host code may change
  the graph*, *Hand the host copies*).

## Blocked by

- None (can start immediately)

## Mode

with the human: it reshapes `packages/comb/src/api/`, the public interface's module and a
protected part of ADR-0007.
