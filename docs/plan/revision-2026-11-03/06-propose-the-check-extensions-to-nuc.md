# Ticket: Propose to NUC what Comb found in its template files

## What to build

Three findings in scope concern files Comb took up from NUC v0.6.2. Fixed in Comb alone, they
diverge at the next take-up, so they go upstream as a proposal for NUC:

- **Check 9 extension.** `scripts/check-docs.sh` in Comb (decd3e91) counts a script that a listed
  script runs by `bash scripts/<name>.sh` or `bash "$ROOT/scripts/<name>.sh"` in that script's
  lists, to any depth (`_with_nested`). It also lets a script that only workflows on
  `# Not a gate:` lines run stand on an `# On instruction:` line. Self-tests are in
  `scripts/test-check-docs.sh`. Review nits to fix on the way: the README says "three commands"
  where there are four, and a `local` is declared twice. `_with_nested wf_scripts` repeats the
  work of the two calls on the gate and no-gate lists.
- **The push checks each branch it sends.** `.githooks/pre-push` runs `scripts/check-all.sh`
  once, on the working tree that is checked out, however many branches one push sends.
  On 2026-11-02 a push of two branches passed the hook on one while #62 carried a lint error,
  and CI went red.
- **A merge in a normalization leaves no citation doubled.** Merging two old ADRs into ADR-0027
  left "(ADR-0027, ADR-0027)" in a comment of `packages/comb/src/bridge/index.ts`.
  Neither `.agents/skills/normalize/remap.sh` nor a check reports it.

The proposal names each with its evidence and a draft of the change against NUC's current
`main`. NUC decides; Comb takes it up with the next release.

## Acceptance criteria

- [ ] Given NUC, when the proposal is filed as a pull request there, then it carries the three
      changes, each with a self-test that fails without it.
- [ ] Given the release of NUC that carries them, when Comb takes it up, then Comb's
      `scripts/check-docs.sh` no longer differs from the template's in check 9.

## Read first

- ADR-0005 (template releases), the normalize skill's take-up steps.
- `scripts/check-docs.sh` (check 9), `scripts/test-check-docs.sh`, `.githooks/pre-push`,
  `.agents/skills/normalize/remap.sh`.

## Blocked by

- None (can start immediately)

## Mode

with the human: a pull request to another repository, and the human decides what NUC takes.
