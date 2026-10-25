# Ticket: The hit test is held to one scan of every kind, computed from the positions

## What to build

ADR-0025's Enforcement asks that a test hits random points of random graphs "with labels and
connectors, at each level", and asserts the target a brute-force scan finds in the order of the
decision. The engine's tests split the kinds instead: the test of labels (`graph/hit.rs`) measures
no label, the one of connectors asks for none, so no engine test decides that a connector comes
before a label. And their oracles read the engine's own state, against `docs/CONVENTIONS.md`
(*An oracle owes nothing to the code it judges*): the node oracle calls `Graph::node_at`, the code
under test; the edge distance is measured to `graph.paths`; the label oracle reads `label_point`
and the pills the graph keeps; and the test of a moved label (`graph/labels.rs`) computes its
expected point from `graph.paths`, so a translate that left paths stale would pass on both sides.

Write one scan over every kind at each level, with labels measured and connectors asked for and
not, whose oracle computes connectors, node bounds, paths (`EdgePath::between`), and label points
from the positions and sizes the test put in, as the bounds test of `graph/edges.rs` does.

## Acceptance criteria

- [ ] Given random graphs with labels and connectors, at each level, with and without connectors
      asked for, when a point is hit, then the target equals the scan's, in the order connector,
      label, node, edge (`Verifies: ADR-0025`).
- [ ] Given the oracles of `graph/hit.rs` and `graph/labels.rs`, when they are read, then none calls
      a function or reads a field of the graph under test beyond the inputs the test gave it.
- [ ] Broken once: with a label put before a connector in `hit_at`, the scan fails; with
      `translate` leaving paths unchanged, the label test fails.

## Read first

- ADR-0025 (*Decision*, *Enforcement*), ADR-0024 (connectors), ADR-0022 (ranks);
  `docs/CONVENTIONS.md` (*An oracle owes nothing to the code it judges*, *Geometry is tested on its
  awkward cases*).
- `crates/engine/src/graph/hit.rs`, `graph/labels.rs`, `graph/edges.rs` (its bounds test, the
  golden path), `graph/tests.rs` (the graphs the tests build).

## Blocked by

- None (can start immediately)

## Mode

unattended: the tests are the change and the broken-once runs decide them; no part the harness ADR
keeps with the human (ADR-0007), and one revert undoes it. Stop: where the scan finds a target the
engine does not, the engine's mistake, file it with the failing case and hand off rather than fix
it here.
