# Ticket: Propose to NUC what Comb found in its template files

## What to build

These findings concern files Comb takes up from NUC. Fixed in Comb alone, they diverge at the
next take-up, so they go upstream as a proposal for NUC:

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
- **The numbering of drafts passes the pre-commit hook.** `scripts/number-adrs.sh` commits twice,
  `docs/adr/` first and the references outside it second, and says the checks fail on the first.
  But `.githooks/pre-commit` runs `scripts/check-docs.sh` on every commit that stages Markdown and
  refuses the first, since the tree still cites the draft identifier elsewhere: on 2026-11-05 both
  `scripts/ready-for-main.sh` and a direct run stopped there, and ADR-0030 was numbered in one
  commit against rule 4 of [`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules) (#79). It stopped
  again for #82 on 2026-11-06, and ADR-0034 was numbered by hand on 2026-11-07. Comb fixed it in
  the script, the hook unchanged: `scripts/number-adrs.sh` rewrites every reference in the working
  tree first, then commits `docs/adr/` alone and the rest after it, and its header no longer says
  the checks fail on the first commit. Since the hook reads the working tree, the first commit
  passes it, and rule 4 holds for both. A case of `scripts/test-number-adrs.sh` runs the script
  with `.githooks/` enabled in the fixture and a stand-in for check 5 of `scripts/check-docs.sh`;
  it fails against the old script with the hook's refusal. The proposal carries both files. The
  sentence of NUC's ADR on tests that says the checks fail on the first commit stays true of
  that commit's tree, which still cites the drafts outside `docs/adr/`; NUC decides whether it
  says more.
- **A merge in a normalization leaves no citation doubled.** Merging two old ADRs into ADR-0027
  left "(ADR-0027, ADR-0027)" in a comment of `packages/comb/src/bridge/index.ts`.
  Neither `.agents/skills/normalize/remap.sh` nor a check reports it.
- **A question is answered, not started.** [`AGENTS.md` §4](../../../AGENTS.md#4-working-style) asks
  the agent to settle scope first and to ask when in doubt, but an agent that takes a question for a
  request has no doubt: asked whether edges could get ports and routing, a session started a plan.
  The proposal adds one sentence to that section, such as "A question about whether or how something
  can be done is answered, not started; the next step waits for an instruction." It stays in prose,
  since no check decides it.
- **An action named without a place is the local one.**
  [`AGENTS.md` §6](../../../AGENTS.md#6-project-rules) says an instruction names the action, but
  "merge" names a local merge and a pull request's merge alike: a bare "merge" once merged two
  pull requests on GitHub where a local merge was meant. The proposal adds a half sentence to that
  section, such as "an action named without a place is the local one; an action on the remote is
  named as such." It is optional, since the section nearly says it, and NUC keeps few rules.

The proposal names each with its evidence and a draft of the change against NUC's current
`main`. NUC decides; Comb takes it up with the next release.

## Acceptance criteria

- [ ] Given NUC, when the proposal is filed as a pull request there, then it carries the changes
      listed above, each change to a script with a self-test that fails without it.
- [ ] Given the release of NUC that carries them, when Comb takes it up, then Comb's
      `scripts/check-docs.sh` no longer differs from the template's in check 9.

## Read first

- ADR-0005 (template releases), the normalize skill's take-up steps.
- `scripts/check-docs.sh` (check 9), `scripts/test-check-docs.sh`, `.githooks/pre-push`,
  `.githooks/pre-commit`, `scripts/number-adrs.sh`, `scripts/ready-for-main.sh`,
  `.agents/skills/normalize/remap.sh`, [`AGENTS.md` §4](../../../AGENTS.md#4-working-style) and
  [`AGENTS.md` §6](../../../AGENTS.md#6-project-rules).

## Blocked by

- None (can start immediately)

## Mode

with the human: a pull request to another repository, and the human decides what NUC takes.
