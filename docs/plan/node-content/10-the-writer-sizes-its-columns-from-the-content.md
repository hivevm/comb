# Ticket: The writer sizes its columns from the content

## What to build

A load of the example with its full content, 50,010 nodes of five to seven elements each, reaches
its first frame without the bridge's node writer copying its columns while it writes. The writer
is sized for about one row of one element a node (`packages/comb/src/bridge/index.ts`, the
`NodeWriter`), so at this content it doubles and copies each content column several times.

The **Benchmark** workflow on 2c11a58 timed the first frame on the AMD EPYC 7763 at 489.8 ms
against the baseline's 378.6 ms (+29 %). A local profile of the load against 9a27df1, before
the content, found the synchronous `comb.load` 40 ms longer: `snapshotOf`
(`packages/comb/src/api/snapshot.ts`) +32 ms, of which the `NodeWriter`'s `add`, the copies of
`grown`, `metric`, `element`, and the cutting of its string columns into pieces +19 ms of self
time, the snapshot's writing of rows, elements, and metrics +10 ms, the wasm-bindgen glue that
passes strings and floats +4 ms, and the engine's layout of the content +7 ms. The first render
and garbage collection did not change.

## Acceptance criteria

- [ ] Given a load of nodes whose content has more rows and elements than one each, when the
      writer writes it, then no column of the writer is reallocated after the first node is
      written, decided at the bridge's seam by a count of the writer's growths.
- [ ] Given the example with its full content at 50,010 nodes, when it loads in the browser
      tests, then it loads as before: the same snapshot, the same problems refused.

## Read first

- ADR-0034 (*Content crosses the bridge as columns*), ADR-0032; `packages/comb/src/bridge/index.ts`
  (`NodeWriter`, `stringColumn`), `packages/comb/src/api/snapshot.ts` (`snapshotOf`, `written`,
  `writeRow`, `writeElement`, `writeMetric`).

## Blocked by

- None (can start immediately)

## Mode

unattended: no test assertion, public interface, accepted ADR, or criterion of the specification
changes. Stop after two attempts at criterion 1 that fail `scripts/check-all.sh`, and write here
what stands in the way.
