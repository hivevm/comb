# Ticket: A second design revision on the same day resets the sensor's count

## What to build

`scripts/sensor-revision-due.sh` counts the changes outside `docs/` since the commit that set the
date of the `Last design revision` line of `docs/ARCHITECTURE.md`, and finds that commit as the
first one, oldest first, whose diff matches the date (`git log --reverse -G… | head -n1`). Two
revisions ran on 2026-10-24: the one that closed the changes since 2026-10-21 and the one that
closed the editing spec. The second leaves the line as it reads, so the sensor still counts from
the first and reports the revision DUE (30 changes since 2026-10-24, due after 20), although it
has just run. The next session told by the sensor would run a revision over work already revised.

Anchor the count on the latest commit that changed the line or, where the date did not change,
on the latest commit that a revision marks, such as the deletion of a `spec.md` beside the line;
choose the simplest rule that a second revision of a day can satisfy without editing anything but
the line, and say which in the pull request. Its self-test covers two revisions on one day.

## What a first attempt found

Counting from the newest commit whose diff of the overview writes the line with its date, `-G`,
made a second revision of a day reset the count only where it rewrote the line, its number at
least; the design-revision skill tells it to move the date to today, which changes nothing on a
second revision of a day. And it made commits that are no revision reset the count too: prose
reworded on the line's own physical line, the line moved, a revert of a revision, an example of
the line in a code block, a duplicate removed. A change to the overview could then hide a
revision that is due. A match of the whole line, `-S`, fixes the rewording and the move but not
the rest. The sensor and the skill are the template's (ADR-0005), so the fix goes upstream to
hivevm/nuc, the sensor and the skill together, on the maintainer's decision; this project takes
it with the next template release.

## Acceptance criteria

- [ ] Given two commits that each move the line to the same date, with changes outside `docs/`
      between them, when the sensor runs after the second, then it counts only the changes after
      the second.
- [ ] Given the self-test (`scripts/test-sensor-revision-due.sh`), when it runs, then it covers that
      case in a temporary repository, beside the cases it holds.
- [ ] Given the tree after this ticket, when the sensor runs, then it reports the revision not
      yet due.
- [ ] Broken once: with the anchor taken as the first matching commit again, the new case of the
      self-test fails.

## Read first

- ADR-0006 (*the revision sensor*); `scripts/sensor-revision-due.sh`,
  `scripts/test-sensor-revision-due.sh`; `docs/ARCHITECTURE.md` (the line).

## Blocked by

- None (can start immediately)

## Mode

with the human: the sensor and its self-test are `scripts/sensor-*.sh` and
`scripts/test-sensor-*.sh`, protected parts of ADR-0007; the sensor may also be the template's
(ADR-0005), in which case the fix goes upstream.
