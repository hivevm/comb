# Ticket: Reject every kind of malformed graph data Q-7 names, through the public interface

## What to build

`load` refuses graph data with two edges of one identifier with a `GraphDataError` naming the
edge, as it refuses two nodes of one identifier today. `updateNode` with an identifier the graph
does not hold throws a `GraphDataError` naming it and leaves the graph unchanged. A property test
feeds the bridge crate's validation random graph data and asserts that every input ends in a
typed error or a valid graph, never a panic. Tests through `comb.load` cite Q-7.

## Acceptance criteria

- [ ] Given graph data with two edges of one identifier, when the host loads it, then `load`
      throws a `GraphDataError` whose problem names that identifier, and the previous graph stays
      drawn.
- [ ] Given a loaded graph, when the host calls `updateNode` with an unknown identifier, then it
      throws a `GraphDataError` naming it, and the store's revision does not change.
- [ ] Given random graph data with non-finite numbers, missing ends, duplicates, and values of the
      wrong type, when the bridge crate validates it, then it returns a typed error or a graph,
      and no case panics (property test, at least 10,000 cases in CI time).
- [ ] Given each kind Q-7 names (non-finite coordinate, edge to a missing node, duplicate
      identifier of a node and of an edge), when it is loaded through `comb.load`, then a test
      citing `Verifies: Q-7` sees the typed error.
- [ ] Broken once: without the duplicate-edge check, the first criterion's test fails.

## Read first

- `docs/SPECIFICATION.md` Q-7; ADR-0010 (*Decision*, errors), ADR-0011, ADR-0009.
- The bridge crate's malformed-data tests and the bridge's malformed-data test, which this
  extends.
- `docs/GLOSSARY.md`: graph data, slot, bridge.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the validation of graph data and `updateNode`'s contract, both kept
with the maintainer by ADR-0007. A property-test crate is a new dev-dependency, named in the pull
request.
