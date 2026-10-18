# Ticket: Say in G-7 what culling with a margin decides

## What to build

A drafted specification change for the maintainer to land or reject. G-7 reads "the system shall
not draw any node, edge, or label that lies entirely outside [the viewport]". The scene binds and
draws what meets the viewport grown by the culling margin of 128 screen pixels, and while the
viewport stays within what it last queried it moves the world alone, so what it draws may reach
twice the margin beyond the viewport. The browser tests that cite G-7 decide exactly that
(`drawnBeyond(page, 128)` after a query, `drawnBeyond(page, 256)` after a move without one), not
the text of G-7. The glossary's *Culling* ("everything that lies entirely outside the viewport")
says the same as G-7 and moves with it.

Draft, for the maintainer to word:

> **G-7** — When the viewport changes, the system shall not draw any node, edge, or label that
> lies entirely outside the viewport grown by a margin of at most two culling margins.

The alternative is to keep G-7 and make the scene drop what left the viewport on every move,
which costs the query the margin exists to save (Q-1).

Accepted ADRs whose basis it moves: none is accepted yet. Proposed ADR-0012 (culling "with a
margin", its follow-up "the margin around the viewport") rests on it, and ADR-0002 holds the
`Verifies: G-7` markers to its text.

## Acceptance criteria

- [ ] Given the draft, when the maintainer decides, then either the specification and the
      glossary's *Culling* say what the G-7 tests decide, or a ticket makes the scene meet the
      present text.
- [ ] Given the decision, when it lands, then the tests citing G-7 assert the bound the
      specification names, and no other.

## Read first

- `docs/SPECIFICATION.md` G-7, `docs/GLOSSARY.md` *Culling* and *Culling margin*.
- ADR-0012 (culling, follow-ups), rule 7 of
  [`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules).
- `examples/metric-tree/e2e/example.spec.ts`, the tests citing G-7;
  `packages/comb/src/render/scene.ts`, `CULLING_MARGIN` and the move without a query.

## Blocked by

- None (can start immediately)

## Mode

with the human: a change to the specification is the maintainer's decision, by rule 7 of
[`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules).
