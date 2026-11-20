# Ticket: The proposed ADRs of uml-diagrams say one statement per sentence before they are accepted

## What to build

[`AGENTS.md` §4](../../../AGENTS.md#4-working-style) asks a rule to state one statement per
sentence, and `scripts/sensor-plain-rules.sh` reports each sentence over 25 words. Over the branch
uml-diagrams (`origin/main..cdb0ae7a`) it reports 33 such sentences, of 26 to 117 words, in the
*Decision* and *Enforcement* of nine of the ten proposed ADRs:

- `docs/adr/API-bridge-columns-carry-nesting.md`: 5, one of 117 words;
- `docs/adr/API-edges-dock-nodes-or-edges.md`: 8;
- `docs/adr/API-edits-report-nested-changes.md`: 2;
- `docs/adr/ARCH-border-nodes-ride-sides.md`: 1;
- `docs/adr/ARCH-engine-edits-nested-graph.md`: 5;
- `docs/adr/ARCH-regions-are-container-slots.md`: 5;
- `docs/adr/REN-moving-layer-moves-content.md`: 1;
- `docs/adr/REN-node-content-and-hits.md`: 1;
- `docs/adr/REN-node-shapes-cover-uml.md`: 5.

Evidence: both reviews of the whole branch, at 9b198f2f and at cdb0ae7a, named the long sentences
as a lesser finding and left them to this revision. A proposed ADR is still revised in place; once
accepted, it changes only by supersession (NUC-decisions-are-proposed-then-accepted §6).

Split each sentence the sensor names into sentences of one statement each, in a commit of ADRs
only, changing no decision.

## Acceptance criteria

- [ ] Given the nine ADRs, when `scripts/sensor-plain-rules.sh` runs over the change, then it
      reports no sentence over 25 words in their *Decision* and *Enforcement*.
- [ ] Given the diff, when the maintainer reads it, then each split says what the sentence said, and
      no test's `Verifies:` citation is invalid (`scripts/check-traceability.sh` passes).

## Read first

- Touches: the nine ADRs listed above
- NUC-decisions-are-proposed-then-accepted §6; [`AGENTS.md` §4](../../../AGENTS.md#4-working-style)
  *Write a rule plainly*; the mechanics of `docs/adr/README.md`.
- The seam: `scripts/sensor-plain-rules.sh <base>`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the ADRs are the maintainer's (DEV-implementer-and-fresh-reviewer), and the work
lands best before the maintainer accepts them, on the branch they stand on.
