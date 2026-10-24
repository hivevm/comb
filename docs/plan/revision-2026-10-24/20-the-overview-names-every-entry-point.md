# Ticket: A check fails where the overview misses a method of `Comb` or of the testing entry

## What to build

Three fixes of the editing work corrected `docs/ARCHITECTURE.md` after review (connectors still
listed as not built, the label exports and the label drag missing), and the design revision that
closed the work found more: `hitKind` and `isDrawn` of `comb/testing` named nowhere, `updateEdge`'s
sides, the edge snapshot types.
[`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done)
asks the overview to change with the structure; a missing name is what a check can decide, a stale
sentence is not.

Add a check, a bash script under `scripts/` with a self-test (ADR-0002), that fails naming each
method of the `Comb` interface (`packages/comb/src/api/index.ts`), each option of `CombOptions`,
and each function `packages/comb/src/testing.ts` exports that `docs/ARCHITECTURE.md` does not name
in backquotes, and run it from `scripts/check-code.sh` or `scripts/check-docs.sh`, whichever owns
project checks of documents. The engine's buffer accessors (`*Ptr`, `*Len`) stay out of it: the
overview names the buffers, not each accessor.

## Acceptance criteria

- [ ] Given an exported function of `testing.ts` that the overview does not name, when the check
      runs, then it fails naming it.
- [ ] Given a method of `Comb` or an option of `CombOptions` the overview does not name, when the
      check runs, then it fails naming it.
- [ ] Given the tree as it stands after this revision, when the check runs, then it passes.
- [ ] Given its self-test, when it runs, then it covers a named, an unnamed, and a renamed entry
      in a temporary tree, and the script that runs the checks runs it.
- [ ] Broken once: with `isDrawn` removed from the overview, the check fails.

## Read first

- ADR-0001 (the overview), ADR-0002 (checks as bash scripts with self-tests), ADR-0008.
- `scripts/check-code.sh`, `scripts/check-docs.sh`, a self-test to copy such as
  `scripts/test-check-structure.sh`; `docs/ARCHITECTURE.md`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the check and its self-test are `scripts/check-*.sh` and `scripts/test-check-*.sh`,
protected parts of ADR-0007.
