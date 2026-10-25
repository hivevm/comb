# Ticket: A module split off a file stays bound by the ADRs that name the file

## What to build

`scripts/sensor-binding-adrs.sh` lists, for a change, the ADRs whose *Applies to* names a path the
change touches, a path standing for itself and everything under it. Ticket 13 of this directory
split `crates/engine/src/graph.rs` into modules under `crates/engine/src/graph/`, as Rust lays out
a module's children; ADR-0022, ADR-0024, and ADR-0025 name `crates/engine/src/graph.rs` alone, and
they are accepted, so their text stays as it reads. A later change to `graph/nodes.rs` or
`graph/hit.rs` alone is then bound by none of them in the sensor's list, and the session that makes
it is not told to read the ADRs that decide those modules. `graph/budget.rs` already had this gap.

Let the sensor take a path `x.rs` to name the directory `x/` beside it too, as Rust's module layout
means, and say so in its header; its self-test covers a change under such a directory.

## Acceptance criteria

- [ ] Given an ADR whose *Applies to* names `crates/engine/src/graph.rs`, when a change touches only
      `crates/engine/src/graph/hit.rs`, then the sensor lists that ADR.
- [ ] Given a path `x.rs` with no directory `x/` beside it, when the sensor runs, then it lists what
      it listed before.
- [ ] Given the self-test (`scripts/test-sensor-binding-adrs.sh`), when it runs, then it covers both
      cases in a temporary repository, beside the cases it holds.

## Read first

- ADR-0006 (*Sensors*), ADR-0007; `scripts/sensor-binding-adrs.sh` and its self-test.

## Blocked by

- None (can start immediately)

## Mode

with the human: the sensor and its self-test are `scripts/sensor-*.sh` and
`scripts/test-sensor-*.sh`, protected parts of ADR-0007; the sensor may also be the template's
(ADR-0005), in which case the fix goes upstream, as for ticket 22.
