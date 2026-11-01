# Ticket: The snapshot reads the host's content in one walk

## What to build

`packages/comb/src/api/snapshot.ts` reads a node's content in two walks that each branch over
the six element kinds: `contentOf`, `elementOf`, `trendOf`, and `segmentsOf` (lines 121–205) build
plain objects for `addNode` and `updateNode`, and `written`, `writeRow`, `writeElement`,
`writeMetric`, and `writeProgress` (lines 269–400) write a load's columns. Both cut rows, columns,
and segments at one past their limits, both treat a list as no object, both read a trend through
`segmentFieldsOf`, and both branch progress, metric, icon, and the rest, an action's identifier
and a badge's colour beside them. Only the load's walk counts the content budget (`counted`).
A rule of reading content, or a seventh kind (ADR-0013), lands in both walks or the two
crossings ADR-0034 decides read the same content differently.

One walk reads the host's content, each field once, and hands what it read to a sink: one sink
builds the plain object `addNode` and `updateNode` hand to serde, the other is the
`NodeColumnWriter` of `packages/comb/src/bridge/index.ts`. The writer's `element`, which takes
seven parameters, most of them for one kind each, may become one method per kind on the way.
Behaviour is unchanged: the same snapshot, the same problems refused, the same reads of each
field.

## Acceptance criteria

- [ ] Given `packages/comb/src/api/snapshot.ts`, when it reads content, then one function walks
      rows, columns, elements, segments, and a trend, and the load and the single node differ
      only in the sink they hand it.
- [ ] Given the snapshot's tests that count each field's reads per kind
      (`packages/comb/src/api/snapshot.test.ts`), when they run against both paths, then every
      field is read once, as now.
- [ ] Given the bridge's tests, the malformed-data and node-content browser tests, and the
      property tests of `crates/engine-wasm`, when they run, then they pass unchanged.
- [ ] Broken once: with the walk's cut at `limits.columns + 1` removed, a test of a row past its
      limit fails for both a load and `addNode`.

## Read first

- ADR-0034 (*Content crosses the bridge as columns*, the serde crossing of one node), ADR-0013,
  ADR-0028; `docs/CONVENTIONS.md` (*Host code may change the graph*);
  `packages/comb/src/api/snapshot.ts`, `packages/comb/src/bridge/index.ts` (`NodeColumnWriter`).

## Blocked by

- None (can start immediately)

## Mode

with the human: `packages/comb/src/api/` and `packages/comb/src/bridge/` are protected parts of
ADR-0007.
