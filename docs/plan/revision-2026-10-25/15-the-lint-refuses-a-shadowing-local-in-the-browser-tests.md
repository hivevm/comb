# Ticket: The lint refuses a shadowing local in the browser tests too

## What to build

Ticket 13 of this directory enabled ESLint's `@typescript-eslint/no-shadow` for every linted file
but the browser tests, `examples/*/e2e/**`, where it found 78 sites, past what one session renames
with care. It renamed by hand four in-page locals named `told`: two hid the shared reader `told` of
`shared.ts`, among them the one of `remove.spec.ts` that review of ticket 16 of the revision of
2026-10-24 found, and two hid the test's own outer `told`; 74 sites remain. Most of them are
Playwright's idiom of handing a value into the page under its own name, `page.evaluate((id) => …,
id)` or `({ id, w, h }) => …`; others are a callback's `name` and `problem` repeating those of a
parameterised test, or a `node` or `edge` local over the helper of `e2e/shared.ts` of that name.

Enable the rule for the browser tests too, and rename what it finds there.

## Acceptance criteria

- [ ] Given `eslint.config.js`, when `bun run lint` runs over a browser test that declares a local
      of an imported or outer name, then it fails naming the line; the test of
      `packages/comb/src/lint.test.ts` that the browser tests are not reported yet then says that
      they are.
- [ ] Given the tree after this ticket, when `bun run lint` runs, then it passes, each finding
      renamed, not disabled.
- [ ] Given `bun run test`, when it runs, then the browser tests pass unchanged in what they
      assert.

## Read first

- ADR-0008 (ESLint, the lint configuration); `eslint.config.js`;
  `packages/comb/src/lint.test.ts` (the lint's own tests).
- `examples/metric-tree/e2e/shared.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended: the lint decides it; a configuration change and renames in tests, no part the harness
ADR keeps with the human (ADR-0007), and one revert undoes it; a browser test that has to change
what it asserts shows it wrong. Stop: where a rename would change what a test asserts or reads,
hand off naming it.
