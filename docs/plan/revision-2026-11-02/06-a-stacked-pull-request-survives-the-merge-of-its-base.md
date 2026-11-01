# Ticket: A stacked pull request survives the merge of its base

## What to build

A decision for the maintainer. The changes counted held a stack: the branch of ticket 12 of
revision-2026-10-31 (pull request #49) started from 0917972 on the branch of ticket 01 (#48),
before #48 merged. The review fix of ticket 01 was then committed on both branches, as ada8968 on
ticket 01's and 398287b on ticket 12's, and both reached `main` (3c40230, 59072d7): the history
holds one fix twice, and the revision sensor counts it twice. The author also recalls that a merge
on GitHub with `--delete-branch` closed a stacked pull request; the history does not show which,
since a closed pull request leaves no commit.

No document of this project says how a stack of pull requests is merged. The maintainer chooses
one of, or rejects:

- **Retarget first:** before the base of a stack merges, its dependent pull request is moved to
  `main`; the README's **Repository settings** or the `work-tickets` skill says so.
- **Keep the branch:** a base with a dependent pull request merges without deleting its branch,
  which is deleted once the dependent one has merged.
- **No stacks:** a ticket whose work needs another's waits for it to merge, as *Blocked by* says,
  and starts from `main`.

What GitHub does with a dependent pull request when its base branch is deleted, by the merge
button or through the API, is to be checked against GitHub's documentation before the choice, not
taken from this ticket. The skill comes from the template (ADR-0005), so a change of it may
belong upstream.

## Acceptance criteria

- [ ] Given the options, when the maintainer decides, then the document the choice names says
      how a stack merges, or this ticket is deleted with the reason.

## Read first

- ADR-0006 (tickets and their claims), ADR-0007 (the cap on open agent work), ADR-0005.
- `.agents/skills/work-tickets/SKILL.md`; `README.md` (**Repository settings**).

## Blocked by

- None (can start immediately)

## Mode

with the human: merging on GitHub is the maintainer's
([`AGENTS.md` §6](../../../AGENTS.md#6-project-rules)), and the skill may be the template's.
