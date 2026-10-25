# Ticket: The binding sensor's rule for Rust modules goes upstream, or is declared this project's

## What to build

Ticket 23 of the revision of 2026-10-24 (commits f224e94 and b52c280) taught
`scripts/sensor-binding-adrs.sh` that a Rust file `x.rs` names the directory `x/` beside it too,
except `lib.rs`, `main.rs`, `mod.rs`, and `build.rs`, so that the modules split off
`crates/engine/src/graph.rs` stay bound by ADR-0022, ADR-0024, and ADR-0025. The sensor is the
template's (ADR-0005) and otherwise language-neutral; both commits call the rule a proposal for
hivevm/nuc, or else a rule of this project, and no plan records which. A template release that
carries its own sensor would drop the rule silently.

The maintainer decides: send the rule upstream, in a language-neutral form (a file `x.<ext>` binds
a sibling `x/`, with the exclusions a language names), or keep it as this project's and record
that where a template release will not overwrite it. Ticket
docs/plan/revision-2026-10-24/22-a-second-revision-on-one-day-resets-the-count.md goes upstream
the same way and may travel with it.

## Acceptance criteria

- [ ] Given the maintainer's decision, when it is taken, then either a proposal for hivevm/nuc
      carries the rule and its self-test cases, or this project records that it keeps the rule
      and how a template release leaves it in place.
- [ ] Given `scripts/test-sensor-binding-adrs.sh`, when it runs after either, then it passes.

## Read first

- ADR-0005 (template releases), ADR-0001 (`scripts/sensor-binding-adrs.sh`), ADR-0007.
- `scripts/sensor-binding-adrs.sh`, `scripts/test-sensor-binding-adrs.sh`; commits f224e94, b52c280.

## Blocked by

- None (can start immediately)

## Mode

with the human: the sensor is a protected part of ADR-0007 and the template's (ADR-0005), and
whether a change goes upstream is the maintainer's decision.
