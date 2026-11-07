# Ticket: The hit test is restated in one ADR at the next normalization

## What to build

What a press hits is decided across four accepted ADRs: ADR-0012 (*Hit testing*, the layers),
ADR-0013 (the order, the connector's reach and its clip, in the node content model), ADR-0031
(the connectors), and ADR-0032 (a node hit within its outline, a press outside it reaching what
lies below). Ticket 07 of the state diagram had to revise the content model's ADR to change a rule
about connectors, and ticket 08 of this directory read "bounds" against ADR-0032 to close a dead
zone. Between normalizations an ADR supersedes whole ADRs, so the maintainer decided
(2026-11-07) that the hit test is stated in one ADR when the record is next normalized, not now.

Accepted ADR-0013 was also rewritten in place twice, against rule 5 of
[`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules): b54821d (a connector reaches a quarter of its
node inside it) and ba4a5c0 (that quarter clipped by the outline). The maintainer recorded both as
a known exception (2026-11-07), which this restatement makes legitimate.

When the maintainer next instructs a normalization (the `normalize` skill), restate the hit test
as one ADR of the new series: the order of the kinds, each kind's reach and clip, the outline, and
what lies below, with the content model, the connectors, and the node shapes no longer stating
them.

## Acceptance criteria

- [ ] Given the normalization's new series, when it is read, then one ADR states the whole hit
      test, and no other ADR of the series states a part of it.
- [ ] Given the tests that cite ADR-0012, ADR-0013, ADR-0031, or ADR-0032 for a hit, when the
      normalization's map moves their references, then each cites the hit test's ADR.

## Read first

- Touches: `docs/adr/`
- ADR-0012 *Hit testing*, ADR-0013 *Hit test*, ADR-0031 *Decision*, ADR-0032 *Hit test*.
- The `normalize` skill; docs/adr/README.md, *Mechanics*.
- The merge messages of 25eb7f9 and of ticket 08 of this directory.

## Blocked by

- None; it waits for the maintainer's instruction to normalize.

## Mode

with the human: a normalization runs only on the maintainer's instruction, and it restates
accepted ADRs.
