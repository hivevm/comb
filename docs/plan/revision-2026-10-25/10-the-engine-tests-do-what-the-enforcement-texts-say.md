# Ticket: The engine's tests do and cite what the Enforcement texts say of them

## What to build

Three tests do less, or cite less, than the accepted ADRs say:

- ADR-0022 (*Edits against a scan*) says its property test "also `Verifies: G-4`"; the property
  tests of `crates/engine/src/graph/tests.rs` cite ADR-0022 alone, and no engine test cites G-4.
- ADR-0024 (*The path*) has the property test of the budget, `crates/engine/src/graph/budget.rs`,
  cite ADR-0024; it cites Q-7, Q-4, and ADR-0027.
- ADR-0022 (*No rebuild per edit*) asks that adding and removing a node and an edge within the
  extent at 50,000 nodes builds the index no time; the test (`graph/index.rs`) removes a node and an
  edge and adds a node, but adds no edge. And since a removal calls no rebuild any more (commit
  1c50917), nothing pins that it does not: the same test counts no call of the rule.

Add the citations, the added edge, and a count that a removal asks the rule of the index nothing.

## Acceptance criteria

- [ ] Given `scripts/check-traceability.sh`, when it runs, then it passes, and G-4 is cited by the
      engine's property test of edits.
- [ ] Given the test of no rebuild per edit, when it runs, then it adds and removes a node and an
      edge at 50,000 nodes and asserts no rebuild (`Verifies: ADR-0022`).
- [ ] Broken once: with `remove_edges` calling `keep_index` again and the rule made to build, the
      count fails.

## Read first

- ADR-0022 (*Enforcement*), ADR-0024 (*Enforcement*), ADR-0002 (markers).
- `crates/engine/src/graph/tests.rs`, `graph/budget.rs`, `graph/index.rs`.

## Blocked by

- None (can start immediately)

## Mode

unattended: tests and the traceability check decide it; no part the harness ADR keeps with the
human (ADR-0007), and one revert undoes it. Stop: where a test cannot be made to fail by the
breakage named, hand off.
