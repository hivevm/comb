# Ticket: Only a snapshot reaches the bridge, and the type checker says so

## What to build

The host application's code once ran inside a call of the engine: serde-wasm-bindgen read a
getter or a Proxy trap of the graph data while it converted it, and a value that threw left the
engine wedged. Since then `api` reads every value once into a snapshot of plain data
(`api/snapshot.ts`) and hands only that to the bridge. Nothing but review keeps it so. The
bridge's `loadGraph(batch: GraphBatch)` and `checkNodePatch(node: string, patch: NodePatch)` take
the generated types. The host's `GraphData` is not assignable to `GraphBatch` today, since its
edge colour and arrowhead are optional, but only by that accident of shape, and the snapshot
reaches it through an `as unknown as GraphData & GraphBatch` cast that would hide any shape. A
host's patch is assignable to `NodePatch` (`{ title?: string }`): a later change that passes
`patch` straight to `checkNodePatch` type-checks, passes every test whose patch has no getter,
and lets host code run in the engine again.

Make the type checker refuse it: the snapshot and the plain patch are types of their own that
only `api/snapshot.ts` can produce (a brand, or a type the generated ones are not assignable to),
and the bridge's `loadGraph` and `checkNodePatch` take those. A type test, in the pattern of
`store/graph-view.test.ts`, asserts with `@ts-expect-error` that the host's `GraphData` and a plain
`{ title }` object are refused by the bridge.

## Acceptance criteria

- [ ] Given the bridge, when a module passes a `GraphData` or an object literal patch to
      `loadGraph` or `checkNodePatch`, then `tsc` fails; the type test pins it.
- [ ] Given the snapshot functions, when they return, then their results are the only values of
      the types the bridge takes, and `api/index.ts` compiles unchanged in behaviour.
- [ ] Given the store, when it keeps the snapshot, then it keeps it as the `GraphData` it reads
      today.
- [ ] Given `snapshotOf`, when it builds the snapshot, then it does so without a cast through
      `unknown`.
- [ ] Broken once: with `checkNodePatch(id, plain)` replaced by `checkNodePatch(id, patch)` in
      `updaterOf` (`api/index.ts`), the type check fails; today it passes.

## Read first

- ADR-0009 (*Bridge*, *Shell*, *What the bridge cannot see*); ADR-0010 (*Structured data*).
- `packages/comb/src/api/snapshot.ts`, `packages/comb/src/api/index.ts` (`loaderOf`,
  `updaterOf`), `packages/comb/src/bridge/index.ts` (`Bridge`).
- `packages/comb/src/store/graph-view.test.ts`, the golden path of a type test.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches `packages/comb/src/api/` and `packages/comb/src/bridge/`, protected
parts of ADR-0007.
