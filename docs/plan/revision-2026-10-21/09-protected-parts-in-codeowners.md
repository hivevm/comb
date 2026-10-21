# Ticket: Name the paths of the protected parts in CODEOWNERS

## What to build

ADR-0007 keeps four parts with the maintainer: the public TypeScript interface, the data format of
the bridge, the validation of graph data that holds Q-5 to Q-7, and the CI workflows. Its
follow-up names their paths in `.github/CODEOWNERS` "once the code exists". The code exists, and
the hardening work changed every one of the four, yet `.github/CODEOWNERS` names only
`docs/SPECIFICATION.md` and `docs/adr/`. Whether a pull request touches a protected part is left
to each ticket's *Mode* and each session's reading.

The maintainer decides the paths, for example `packages/comb/src/index.ts` and
`packages/comb/src/api/` (the interface and the refusal in `updateNode`), `crates/engine-wasm/`
and `packages/comb/src/bridge/` (the bridge's format and the validation), and
`.github/workflows/`, and they land in `.github/CODEOWNERS` with the reason in its header.

## Acceptance criteria

- [ ] Given the maintainer's list, when `.github/CODEOWNERS` is read, then it names each path of
      a protected part, and its header says which part of ADR-0007 each serves.
- [ ] Given a pull request that changes one of those paths, when it opens, then GitHub requests
      the maintainer's review, once the setting the README lists is on.

## Read first

- ADR-0007 in full; `.github/CODEOWNERS`; the README's *Repository settings*.

## Blocked by

- None (can start immediately)

## Mode

with the human: `.github/CODEOWNERS` is named by ADR-0007, which decides who reviews, and the
paths are the maintainer's to choose.
