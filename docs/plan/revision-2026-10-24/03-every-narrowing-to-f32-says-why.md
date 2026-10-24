# Ticket: Every narrowing to f32 in the engine says why it holds

## What to build

Three mistakes in a row, one just before the counted changes and two among them, were of one
kind: a value computed in `f64` and narrowed to `f32` where the narrowing lost what Q-4 or Q-7
needed. Coordinates of `1e300`, finite in `f64`, became infinite in `f32` and passed the check
(the convention *Check a value as the engine keeps it* came of it); the mesh's vertices
rounded by their distance from the world's origin, up to 8 px at ±5e7 (ticket 18 of
revision-2026-10-21); then segments whose ends lay far outside the rectangle kept that rounding
(ticket 20). Each was found by later work, not by a check, and each fix was a narrowing done
differently. The convention says what to do; nothing makes a session look at a narrowing it
writes.

Clippy's `cast_possible_truncation` flags every `f64 as f32` (and `usize as u32`, `f64 as usize`)
in the engine's two crates: 23 sites outside the tests today, run with
`cargo clippy --workspace --all-features -- -W clippy::cast_possible_truncation`. Deny it in the
workspace's lints, outside test code, and give each site either a conversion that states its
range (`u32::try_from`, a checked narrowing) or an `#[expect(clippy::cast_possible_truncation,
reason = "…")]` whose reason says why the value fits: checked as `f32` by the bridge, relative to
the query's origin (ADR-0010), a count bounded by the limits of a load (ADR-0026). The distance
along a path (`stroke.rs`, `distances`), a residual ADR-0010 and ADR-0027 record, gets a reason
that says so.

The sensor list of ADR-0008 (*Sensors for maintainability*) names the lints the workspace
denies; adding one revises it in a pull request of ADRs only, before the code. The lint makes a
session look at each narrowing; it does not decide that a value is checked after it is narrowed,
so the convention *Check a value as the engine keeps it* stays.

## Acceptance criteria

- [ ] Given the workspace lints, when `bun run lint` runs, then a new `f64 as f32` outside test
      code without an `expect` and its reason fails clippy.
- [ ] Given each of today's sites, when the change lands, then it carries a checked conversion or
      an `expect` whose reason names what bounds the value, and no behaviour changes:
      `cargo test --workspace` and the browser tests pass as before.
- [ ] Given ADR-0008, when the lint lands, then its sensor list names it (revision merged first).
- [ ] Broken once: a fresh `let x = y as f32;` in `graph.rs` fails `bun run lint`.

## Read first

- ADR-0008 (*Sensors for maintainability*); ADR-0010 (*Origin*, the rounding consequences);
  ADR-0026 (*Bridge*, the limits).
- `docs/CONVENTIONS.md` (*Check a value as the engine keeps it*); `Cargo.toml`
  (`[workspace.lints]`), `clippy.toml`; the sites in `crates/engine-wasm/src/lib.rs` and
  `crates/engine/src/` (`graph.rs`, `spatial.rs`, `stroke.rs`).
- Clippy, `cast_possible_truncation` —
  <https://rust-lang.github.io/rust-clippy/master/#cast_possible_truncation>.

## Blocked by

- None (can start immediately)

## Mode

with the human: it revises ADR-0008 and touches `crates/engine-wasm/`, `stroke.rs`, and
`graph.rs`, protected parts of ADR-0007.
