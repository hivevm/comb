# Ticket: Decide what a spec's revision does with the changes the count holds

## What to build

A decision for the maintainer. ADR-0006 makes a revision due in two ways: when a feature spec
closes, over the modules its tickets touched, and after a number of changes without a spec, over
the modules those changes touched. Either revision moves the `Last design revision` line, and the
count starts again from the commit that moves it. The `design-revision` skill gives each kind its
own scope ("One session, one spec"; "One session, one count").

On 2026-10-21 both were due together. The revision that closed *Hardening and evidence* revised
the spec's five changes and moved the line. The count then stood at 23 of 20, and the other
eighteen changes no spec covered were not revised. Moving the line reset the count. A ticket
caught those eighteen, and its revision filed
docs/plan/revision-2026-10-21/11-one-home-for-the-edge-defaults.md to
docs/plan/revision-2026-10-21/14-every-action-by-commit-sha.md. Without that ticket, the count
would not have shown them.

Ways to close the gap, for the maintainer to choose or reject:

- **The spec's revision takes the counted changes too** when the count is due as it runs. The
  skill's *Scope* adds the directories the sensor lists to the spec's scope. The session is
  larger, but the line moves only over what was revised.
- **The spec's revision moves the line only when the count is not due**, and otherwise files a
  ticket for the counted changes, as happened by hand on 2026-10-21. The skill's *File, do not fix*
  says so.
- **The count runs first**: a due count is revised before a spec closes. The skill's *Scope*
  says so.
- **No change**: the reset is accepted, and a spec's revision counts as revising the changes it
  did not look at.

The first three change the skill and leave ADR-0006's decision as it is. ADR-0006 decides when a
revision is due and that it moves the date. It does not decide a scope that covers both kinds
at once. Whether ADR-0006 needs a revision as well is the maintainer's question. The skill and
ADR-0006 come from the template, so the change may belong upstream (ADR-0005).

## Acceptance criteria

- [ ] Given the options, when the maintainer decides, then the skill, ADR-0006, or the template
      upstream changes as decided, or this ticket is deleted with the reason.
- [ ] Given the decision, when a spec closes while the count is due, then the skill says which
      changes the revision covers and when the line moves.

## Read first

- ADR-0006 (*Decision*, the paragraph on revisions without a spec); ADR-0005 (template releases).
- `.agents/skills/design-revision/SKILL.md` (*Scope*, *File, do not fix*);
  `scripts/sensor-revision-due.sh`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the skill and ADR-0006 come from the template, and the scope of a revision is
the maintainer's decision.
