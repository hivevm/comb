# Ticket: A comment wider than 100 columns fails a check

## What to build

Comments in Rust and TypeScript are wrapped at 100 columns, as Prettier's `printWidth`
(`.prettierrc.json`) and check 15 of `scripts/check-docs.sh` for Markdown prose hold code and
documents, but no check holds a comment: Prettier and rustfmt on stable leave comments as written.
Review finds the overlong lines by eye, and each finding costs a commit of its own: 4f41695
(first-frame ticket 06), e897a4e, and 1bbcf7a in three days. 25 comment lines over 100 columns
stand on `main` all the same, among them `packages/comb/src/bridge/index.ts:1104` (133 columns),
`crates/engine-wasm/src/lib.rs:440` (126), and `packages/comb/src/api/snapshot.ts:10` (107).

A check, run by `scripts/check-code.sh`, fails a comment line of a `.rs` or `.ts` file wider than
100 columns, naming the file and line, a URL that does not fit standing on a line of its own as
check 15 allows; the 25 lines are wrapped in the same change. ESLint's `max-len` with a code width
it never reaches and `comments: 100` is one way for TypeScript; Rust needs the script, since
rustfmt's `comment_width` is unstable.

## Acceptance criteria

- [ ] Given a `.rs` or `.ts` file with a comment line of 101 columns, when `scripts/check-all.sh`
      runs, then it fails naming the file and the line; one of 100 columns passes.
- [ ] Given the self-test of the check, when it runs, then it plays both cases, a URL on a line of
      its own, and a source it reads no file from, which fails (`docs/CONVENTIONS.md`, *A check
      fails on what it cannot read*).
- [ ] Given `main` after the change, when the check runs, then it passes.

## Read first

- ADR-0008 (the lint and formatter), ADR-0002 (checks under `scripts/`); `scripts/check-code.sh`,
  check 15 of `scripts/check-docs.sh` as the golden path, `eslint.config.js`, `.prettierrc.json`.

## Blocked by

- None (can start immediately)

## Mode

with the human: `scripts/check-code.sh` and every `scripts/check-*.sh` are protected parts of
ADR-0007.
