# Ticket: Revise the changes since 2026-10-18 that no spec covered

## What to build

The design revision of 2026-10-21 closed *Hardening and evidence* and moved the `Last design
revision` line, as the `design-revision` skill asks. When it ran, the revision sensor counted 23
changes outside `docs/` since 2026-10-18 and reported the revision due. Five were the spec's
tickets. The other eighteen were the work of the tickets of the revision of 2026-10-18 and of the
benchmark baseline: the Canvas 2D fallback (ADR-0018), the runner gate and the baseline of the
benchmark, mutation testing of the engine and the mutants it killed, two fixes of the engine's
geometry, the narrowed query and each edge's bounds computed once, the split of the scene
module, and the checks of the work per frame and of detached views. That revision scoped itself
to one spec, so none of the eighteen was revisited, and the moved line no longer counts them.

A fresh session runs `design-revision` with these changes as its scope: the commits from
`a05e41e` through `8323d2a` on `main` and the directories they touched: `crates/`, every module
of `packages/comb/src/` (`render`, `bridge`, `api`, and `interaction` above all),
`examples/metric-tree/` (its source and its browser tests), `bench/`, `scripts/`, and
`.github/workflows/`.

## Acceptance criteria

- [ ] Given the eighteen commits, when the revision runs, then it surveys the modules they
      touched, reads the ADRs that bind them (ADR-0008, ADR-0010, ADR-0012, ADR-0018 among them),
      and files what it finds under `docs/plan/revision-<date>/`.
- [ ] Given its findings filed, when it ends, then this file is deleted in its pull request.

## Read first

- `.agents/skills/design-revision/SKILL.md`; ADR-0006 (*revision*).
- `git log --no-merges a05e41e^..8323d2a -- . ':!docs'`.

## Blocked by

- None (can start immediately)

## Mode

with the human: ADR-0006 owes this revision, since the count had reached its number when the
line moved; the maintainer is told that the skill's one-spec scope and ADR-0006's count
disagreed here, and decides whether the skill or the order of revisions changes.
