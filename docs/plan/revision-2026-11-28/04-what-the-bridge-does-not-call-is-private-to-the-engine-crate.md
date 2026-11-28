# Ticket: What the bridge does not call is private to the engine crate

## What to build

`docs/ARCHITECTURE.md` says of `crates/engine` that only what the bridge uses is public, and the
rest private to the crate, so that the `dead_code` lint finds what only tests reach. Public
functions the revision's review found that nothing under `crates/engine-wasm/src` calls, a floor
and not the full set (constants, types, and fields were not scanned), outside `shape.rs`:

- in `crates/engine/src/content.rs`: `Font::line_height`;
- in `crates/engine/src/graph/`: `Graph::divided_node` (`regions.rs`), `Graph::with_held`
  (`containers.rs`), and `Handle::pulls` (`resize.rs`).

The functions of `crates/engine/src/shape.rs`, `NodeShape::height` among them, are ticket 06 of
this revision, split off by the human on 2026-11-28 to run unattended. The overview says since
this revision that the crate does not hold to the rule yet.

Evidence: the review of ticket 04 of revision-2026-11-20 (PR #118) left `NodeShape::height` for
the maintainer, "against ARCHITECTURE.md's rule that only what the bridge uses is public". The
review of this revision found the others.

Let each be `pub(crate)`, or removed where only a test calls it. Then, with ticket 06 landed, let
the overview's sentence say the rule holds.

## Acceptance criteria

- [ ] Given `crates/engine/src/`, when every `pub fn` and `pub const fn` reachable from the crate
      root is listed (in a public module, or a method of a public type such as `Graph`, whose
      modules are private), then each is called or imported by code under `crates/engine-wasm/src`.
- [ ] Given `docs/ARCHITECTURE.md`, when its part *Engine* is read, then it says without exception
      that only what the bridge uses is public.
- [ ] Given the workspace, when `scripts/check-all.sh` runs, then it passes.

## Read first

- Touches: `crates/engine/src/content.rs`, `crates/engine/src/graph/regions.rs`,
  `crates/engine/src/graph/containers.rs`, `crates/engine/src/graph/resize.rs`,
  `docs/ARCHITECTURE.md`
- ARCH-one-workspace-per-example (*Core*).
- The seam: the tests of `crates/engine/src/content.rs` and of `crates/engine/src/graph/`.

## Blocked by

- docs/plan/revision-2026-11-28/06-what-the-bridge-does-not-call-in-shape-rs-is-private.md

## Mode

with the human: `crates/engine/src/graph/` is a protected part the maintainer reviews. The part in
`shape.rs` is ticket 06, unattended.
