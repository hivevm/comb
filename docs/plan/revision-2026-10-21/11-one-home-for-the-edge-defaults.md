# Ticket: The engine keeps no edge default that only its tests read

## What to build

An edge without a colour is drawn in `0x9aa1ad`, with an arrowhead at its end. In TypeScript the
colour has one home, `EDGE_COLOR` with `edgeColor` in `render/edges.ts`, which `api` and the
labels layer call. The arrow's default is spelled inline in `batchOf` (`arrow ?? "end"` in
`api/index.ts`). The engine repeats both: `crates/engine/src/stroke.rs` implements `Default for
EdgeStyle` with the same colour and `arrow: true`. Only the engine's tests call that
implementation; the bridge crate builds every `EdgeStyle` from the batch. The `dead_code` lint
does not see a trait implementation, so it does not report this test-only code in a production
module, although the overview says the lint finds what only tests reach.

The engine's tests build their styles from a helper under `#[cfg(test)]`, and the production
crate holds no default for an edge's style. The arrow's default gets a named constant beside
`EDGE_COLOR`, so that each default of an edge stands once in the shell.

## Acceptance criteria

- [ ] Given `crates/engine`, when it is built without tests, then it holds no `Default` for
      `EdgeStyle`, and the engine's tests pass unchanged in what they assert.
- [ ] Given the TypeScript sources, when they are searched for the default edge colour and the
      default arrow, then each stands once, as a named constant.
- [ ] Given an edge without a colour or an arrow, when the example draws it, then it is drawn in
      the default colour with an arrowhead at its end, as the browser tests already assert.

## Read first

- ADR-0009 (*Core*, *Shell*), ADR-0010, ADR-0012.
- `crates/engine/src/stroke.rs` (`EdgeStyle`), `crates/engine-wasm/src/lib.rs` (where it builds
  `EdgeStyle`), `packages/comb/src/api/index.ts` (`batchOf`),
  `packages/comb/src/render/edges.ts`.
- docs/plan/revision-2026-10-21/01-check-what-only-the-store-keeps.md, which changes `batchOf`
  too.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the engine's tests and the browser tests of colours and
  arrowheads pass unchanged;
- scope: test helpers in `crates/engine` and one constant in the shell; one revert undoes it;
- cap: it counts as one of the two pieces of open agent work ADR-0007 allows, and starts only
  when fewer than two are open;
- no protected part of ADR-0007: the public interface, the data format of the bridge, and what
  the validation refuses stay as they are;
- a wrong result shows as a red test; the unchanged suite proves it right;
- stop: if docs/plan/revision-2026-10-21/01-check-what-only-the-store-keeps.md is in progress
  on a branch, leave `batchOf` alone until it merges; if a production path of the engine turns
  out to use the default, hand off with that path.
