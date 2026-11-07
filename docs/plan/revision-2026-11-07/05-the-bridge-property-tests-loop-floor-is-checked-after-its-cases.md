# Ticket: The bridge property test's loop floor is checked after its cases, not inside the last

## What to build

`an_added_edge_is_refused_exactly_as_a_load_of_it_alone_and_a_loop_besides_unless_allowed` in
`crates/engine-wasm/src/properties.rs` counts the loops it adds and refuses in the statics
`LOOPS_ADDED` and `LOOPS_REFUSED`, and asserts the floor of 200 each inside the case whose run
counter `ADDED_EDGE_RUNS` reaches `CASES`. Ticket 03 of the state diagram (merge f2646dd,
*Doubts*) named the weakness: a case proptest replays, from a persisted regression or while it
shrinks a failure, moves the counter, so the floor is checked early, on fewer cases, or, where the
counter passes `CASES` without meeting it, never, without a sign. The convention *A random test
counts the cases each clause rests on* asks for a floor that fails when the cases are missing, not
one that may be skipped.

Run the cases through proptest's `TestRunner` inside one ordinary test, or another form that
returns after the last case, and assert the floor once after it, from counts the test owns rather
than statics.

## Acceptance criteria

- [ ] Given the test, when it runs, then the floor of 200 loops added and 200 refused is asserted
      once, after every case has run, from counts no other test or replay can move.
- [ ] Given the floor raised past what the cases give, such as 50,000, when the test runs, then it
      fails naming both counts, as ticket 03 watched it fail.
- [ ] Given the generator changed so that `loops` is always false, when the test runs, then it
      fails on the floor of loops added.

## Read first

- Touches: `crates/engine-wasm/src/properties.rs`
- ADR-0031, *Enforcement*; ADR-0010.
- The convention *A random test counts the cases each clause rests on*.
- The other floors of the engine's property tests, such as `crates/engine/src/graph/budget.rs`,
  which count inside one test.

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine-wasm/` is a protected part of ADR-0007, never worked unattended.
