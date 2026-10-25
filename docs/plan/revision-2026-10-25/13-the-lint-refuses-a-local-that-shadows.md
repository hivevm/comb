# Ticket: The lint refuses a local name that shadows an outer one

## What to build

Review of ticket 16 of the revision of 2026-10-24 (commit 6f905c9) found a test of
`examples/metric-tree/e2e/remove.spec.ts` that declared a local `told`, shadowing the reader
`e2e/shared.ts` exports, so the test read its own list where the reader was meant. A check decides
this: ESLint's `@typescript-eslint/no-shadow`. Enable it for the library's sources and tests, the
example's sources, and the benchmark, and rename the 19 sites it finds there.

The maintainer cut the ticket into slices: over the browser tests as well the rule finds 97 sites,
78 of them in `examples/*/e2e/**`, mostly Playwright's idiom of handing a value into the page
under its own name. That slice is ticket 15 of this directory. This one also renames by hand the
four locals of the browser tests that hide a name the test meant to read, the `told` of
`remove.spec.ts` among them.

## Acceptance criteria

- [ ] Given `eslint.config.js`, when `bun run lint` runs over a file of the library, the example's
      sources, or the benchmark that declares a local of an imported or outer name, then it fails
      naming the line; over a browser test it does not yet.
- [ ] Given the tree after this ticket, when `bun run lint` runs, then it passes, each finding
      renamed, not disabled.
- [ ] Given the four locals of `remove.spec.ts`, `add-node.spec.ts`, `connect.spec.ts`, and
      `engine-lost.spec.ts` that shadow a name the test reads, when they are read, then each is
      renamed, and nothing a test asserts changes.
- [ ] Given `bun run test`, when it runs, then it passes.

## Read first

- ADR-0008 (ESLint, the lint configuration); `eslint.config.js`.
- `examples/metric-tree/e2e/shared.ts`; `packages/comb/src/lint.test.ts` (the lint's own tests).

## Blocked by

- None (can start immediately)

## Mode

unattended: the lint decides it; a configuration change and renames, no part the harness ADR keeps
with the human (ADR-0007), and one revert undoes it. Stop: where a rename changes behaviour, hand
off naming it.
