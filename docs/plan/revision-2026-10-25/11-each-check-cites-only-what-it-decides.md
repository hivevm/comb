# Ticket: Each check cites only the decision it decides

## What to build

ADR-0002 has a test cite, with `Verifies:`, the decision or criterion it decides. Three checks of
this round cite a neighbour instead:

- `scripts/check-engine.sh` and its self-test cite ADR-0008, whose text says nothing of an engine
  older than its sources; freshness is dev-only tooling, which needs no ADR
  ([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 2).
- `scripts/test-check-bundle.sh` cites ADR-0010 for the bundle's refusal of the `detaching` seam,
  and `check-bundle.sh` names ADR-0010 beside its failures; ADR-0010 decides views on engine-owned
  buffers, not a test-mode seam or keeping it out of a build. ADR-0021 decides its own seam.
- The *Boundaries* part of `scripts/check-structure.sh` verifies no ADR, as it says, but names
  `docs/ARCHITECTURE.md` as where its rule comes from, in its header and its failure, while the
  overview holds no rule (ADR-0001). The rule, that the render layer imports nothing from
  interaction, is a judgement call the check decides, which makes the check its home
  ([`AGENTS.md` §4](../../../AGENTS.md#4-working-style)); the overview describes it.

Make each cite what it decides or say that it decides none, and name the boundary's rule as the
check's own, the overview as where it is described.

## Acceptance criteria

- [ ] Given `check-engine.sh`, `test-check-engine.sh`, `check-bundle.sh`, and
      `test-check-bundle.sh`, when their headers and messages are read, then each ADR they name
      decides what they check, and a check that decides none says so.
- [ ] Given the *Boundaries* part of `check-structure.sh`, when it fails, then its message names the
      rule as the check's, not as the overview's.
- [ ] Given `scripts/check-traceability.sh` and the self-tests, when they run, then they pass, and
      every accepted ADR is still cited.

## Read first

- ADR-0002 (*Decision*, markers), ADR-0001 (what the overview holds), ADR-0008, ADR-0010, ADR-0021
  (*Tests*); `docs/CONVENTIONS.md` (*Cite the clause a test decides*).
- `scripts/check-engine.sh`, `scripts/test-check-engine.sh`, `scripts/check-bundle.sh`,
  `scripts/test-check-bundle.sh`, `scripts/check-structure.sh` (part 6).

## Blocked by

- None (can start immediately)

## Mode

unattended: the traceability check and the self-tests decide it; it changes headers, messages, and
markers only, no part the harness ADR keeps with the human (ADR-0007), and one revert undoes it.
Stop: where removing a citation leaves an accepted ADR cited by no test, hand off, since the ADR
then needs a test or a *Not mechanically decidable* paragraph.
