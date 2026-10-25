# Ticket: The lint refuses a local name that shadows an outer one

## What to build

Review of ticket 16 of the revision of 2026-10-24 (commit 6f905c9) found a test of
`examples/metric-tree/e2e/remove.spec.ts` that declared a local `told`, shadowing the reader
`e2e/shared.ts` exports, so the test read its own list where the reader was meant. A check decides
this:
ESLint's `@typescript-eslint/no-shadow`. Enable it for the library's sources, the example, its
browser tests, and the benchmark, and rename what it finds.

## Acceptance criteria

- [ ] Given `eslint.config.js`, when `bun run lint` runs over a file that declares a local of an
      imported or outer name, then it fails naming the line.
- [ ] Given the tree after this ticket, when `bun run lint` runs, then it passes, each finding
      renamed, not disabled.
- [ ] Given `bun run test`, when it runs, then it passes.

## Read first

- ADR-0008 (ESLint, the lint configuration); `eslint.config.js`.
- `examples/metric-tree/e2e/shared.ts`; `packages/comb/src/lint.test.ts` (the lint's own tests).

## Blocked by

- None (can start immediately)

## Mode

unattended: the lint decides it; a configuration change and renames, no part the harness ADR keeps
with the human (ADR-0007), and one revert undoes it. Stop: where the rule finds more than about
thirty sites, or one whose rename changes behaviour, hand off with the count.

## Where it stands

Handed off at the stop of the *Mode*: enabled for every linted file, `@typescript-eslint/no-shadow`
finds 97 sites, past the stop of about thirty. By part: 78 in the browser tests, 11 in the
library's sources, 1 in its tests, 6 in the benchmark, 1 in the example's sources. The option
`hoist: "never"` leaves 96.

Most sites in the browser tests are Playwright's idiom of handing a value into the page,
`page.evaluate((id) => …, id)` or `({ id, w, h }) => …`, where the callback's parameter repeats
the outer name for the same value; others are a callback's `name` and `problem` repeating those of
a parameterised test, or a `node`/`edge` local over a helper of the same name, the kind the review
found. In the library they are gesture handlers whose `(x, y)` repeat the press point's
parameters, and in `interaction/connect.ts` a parameter `connection` named after the exported
function `connection`.

To decide: rename all 97, or limit the rule's scope (for instance outside the browser tests'
`page.evaluate` callbacks, which no option of the rule tells apart), or cut the ticket into
slices by part.
