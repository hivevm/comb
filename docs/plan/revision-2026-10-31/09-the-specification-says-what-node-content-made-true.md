# Ticket: The specification says what node content made true

## What to build

The node-content work served criteria whose text no longer says what the tests decide. Three
drafted changes of `docs/SPECIFICATION.md`, each the maintainer's to land, take, or refuse
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). No agent lands them.

**1. Q-4 names the rectangles of node content.** Sixteen layout tests of
`crates/engine/src/content.rs` (from line 729) cite `Verifies: ADR-0013, Q-4` and hold every
element's rectangle to a reference within 0.5 px, but Q-4 names only edge paths and label
positions, so the citation names a criterion whose text does not say what the tests assert
(`docs/CONVENTIONS.md`, *Cite the clause a test decides*). Draft of its first sentence:

> **Q-4** — Geometric accuracy: edge paths, label positions, and the rectangles of node content
> deviate by at most 0.5 px from a reference computation at every zoom level, for everything the
> viewport shows.

Moves: ADR-0013 (*Layout*, its Consequences weigh Q-4). If refused, the sixteen markers drop
`Q-4` instead.

**2. G-10 names the action.** G-10 lists "text, icon, progress bar, badge, value with trend";
ADR-0013 decides a sixth element, the action, whose click carries its identifier, and the
browser tests of `examples/metric-tree/e2e/content-click.spec.ts` decide it. Draft:

> **G-10** — When the host application describes the content of a node as elements (text, icon,
> progress bar, badge, value with trend, action), the system shall draw those elements inside
> the node; node types differ only in that description, and a click on an element is reported to
> the host application, for an action with its identifier.

Moves: ADR-0013 (*Elements*, *Clicks*).

**3. G-9 names what the example shows.** ADR-0013's Context says G-9 names an icon with a kind
and a "Details" link; G-9 names neither, though the example shows both and its browser tests
check them (`examples/metric-tree/e2e/example.spec.ts`). Draft of its second sentence:

> The example shows a metric tree that flows from left to right: bets with a hypothesis and a
> status badge, epics with a progress bar and a status badge, input metrics with values over
> three periods and coloured trends, one north-star metric, and KPIs, each with an icon of its
> type and a "Details" link.

Moves: ADR-0013 (Context).

**4. Optional: a Non-Goal of text shaping.** The engine advances each glyph by its own width from
the left, without kerning, ligatures, or right-to-left text; the closed spec kept these out of
scope, and nothing lasting says so. Draft:

> - No text shaping in node content: no kerning, ligatures, or right-to-left and bidirectional
>   text.

Moves: ADR-0013 (*Fonts*).

## Acceptance criteria

- [ ] Given each draft, when the maintainer decides it, then it is landed by the maintainer or
      refused, and a refusal of draft 1 drops `Q-4` from the sixteen markers.
- [ ] Given a landed change, when `scripts/check-docs.sh` runs, then it passes.

## Read first

- `docs/SPECIFICATION.md` (G-9, G-10, Q-4, Non-Goals), ADR-0013;
  docs/plan/revision-2026-10-24/21-the-specification-says-what-editing-made-true.md, which drafts
  changes of the same kind.

## Blocked by

- None (can start immediately)

## Mode

with the human: the specification is the maintainer's
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7), and
`docs/SPECIFICATION.md` is a protected part of ADR-0007.
