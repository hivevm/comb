# Ticket: The rules tests of the state and the activity diagram pin each refusal's reason

## What to build

The convention *The UML example's rules of connection are a table of what they refuse* says that
the test of `examples/uml/src/rules.ts` writes the table out, the first rule that holds saying why.
For the use case diagram it does: 447cb8a3 wrote a `WHY` table and the expected reason of each
refused pair. For the state and the activity diagram it does not:

- the loop over the pairs in `examples/uml/src/rules.test.ts` asserts only that a reason is a
  string;
- the tests of the state and the activity diagram count the distinct reasons (14 and 18) and check
  their form, not which reason a pair gets.

Of the state diagram's reasons, eight are asserted nowhere, neither in a Bun test nor in
`state-edit.spec.ts`: the frame, the initial pseudostate, `join_segment_state`,
`fork_segment_guards`, `join_segment_guards`, `outgoing_from_initial`, the loop, and the anchor of a
comment. Of the activity diagram's, thirteen are asserted nowhere. Two rules swapped in `rules.ts`
keep both tests green.

Evidence: the second review of ticket 13 of uml-diagrams found the reasons checked only by count
(finding 9); the fix was made for the use case diagram alone (447cb8a3) and watched fail with two
rules swapped. The review of the whole branch at 9b198f2f named the state and the activity tests
again.

Write the state's and the activity's tables as 447cb8a3 wrote the use case's: a `WHY` per diagram,
worded as the convention words each rule, and a function that gives the expected reason of each
refused pair, which the test compares with `refusal`.

## Acceptance criteria

- [ ] Given each reason of the state diagram's and of the activity diagram's rules, when
      `rules.test.ts` runs, then it asserts that reason as an exact string for at least one pair.
- [ ] Given two rules of the state diagram swapped in `rules.ts`, and then two of the activity
      diagram, when `rules.test.ts` runs, then it fails each time, though the count of reasons
      holds.
- [ ] Given a reason added to a `WHY` table that no refused pair expects, when `rules.test.ts`
      runs, then it fails.

## Read first

- Touches: `examples/uml/src/rules.test.ts`
- ARCH-one-workspace-per-example; the convention *The UML example's rules of connection are a
  table of what they refuse* in `docs/CONVENTIONS.md`.
- The golden path: 447cb8a3, the use case diagram's `WHY` and `useCaseRefusal`.
- The seam: `bun test` in `examples/uml/`.

## Blocked by

- None (can start immediately)

## Mode

unattended:

- a test decides it, and the mutation of two swapped rules proves the test right;
- it touches one test file of the example and no protected part, and a wrong result costs one
  revert;
- it touches no part the harness ADR, DEV-implementer-and-fresh-reviewer, keeps with the human,
  and fits under its cap of two open pieces of agent work;
- a wrong result shows as a test that passes with two rules swapped, which the hand-off records;
- the stop: where a reason in `rules.ts` contradicts the convention's wording, the session leaves
  the pair in the hand-off and asks the human which one is right, rather than change either.
