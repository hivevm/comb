# Ticket: ADR-0025 says when connectors are hit

## What to build

ADR-0025, proposed, decides one hit-test call that takes a world point, the size of a screen
pixel, and the level of detail, and returns a connector first "at the near and the middle level".
The implementation takes a fourth argument, whether to look for connectors (`hit_at(..,
connectors)` in `crates/engine/src/graph.rs`, `hit` in `crates/engine-wasm/src/lib.rs`), which the
shell sets where `CombOptions.canConnect` is set, so that without a veto no connector is hit, as
ADR-0023 (*Without `canConnect`, no connection is begun*) and the connect browser tests ask. The
record and the code disagree, and a reader of ADR-0025 would take the flag for a mistake.

Revise ADR-0025 while it is proposed, in a pull request of ADRs only
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rules 3 and 4), so that its Decision says that
the shell asks for connectors only where a connection could begin, and in what form the call
takes that (a flag, or a scope the call names); or, if the maintainer prefers, change the code to
what the ADR says. Its Enforcement names the test that decides it (`connect.spec.ts`, the hit test
without connectors).

## Acceptance criteria

- [ ] Given ADR-0025's Decision, when it is read beside `hit_at` and the `hit` export, then it names
      every argument they take.
- [ ] Given its Enforcement, when it is read, then it names the test that a connector is not hit
      where no connection can begin.
- [ ] Given `scripts/check-docs.sh`, when it runs, then it passes.

## Read first

- ADR-0025, ADR-0023 (*Vetoes*), ADR-0024 (*Levels*); `crates/engine/src/graph.rs` (`hit_at`),
  `crates/engine-wasm/src/lib.rs` (`hit`), `packages/comb/src/interaction/index.ts` (`targetAt`).

## Blocked by

- None (can start immediately)

## Mode

with the human: a revision of an ADR is the maintainer's to decide (ADR-0007, *Decider*).
