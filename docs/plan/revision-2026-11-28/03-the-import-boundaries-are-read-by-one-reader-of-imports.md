# Ticket: The import boundaries between modules are read by one reader of imports

## What to build

Three places read which module imports which to hold a boundary, each with a pattern of its own,
and each sees a different set of the forms an import is written in:

- `scripts/check-structure.sh`, rule 6: the render layer imports nothing from `interaction/`; it
  reads imports and re-exports on one line or several, by a relative path;
- `packages/comb/src/interaction/interaction.test.ts`, the test that no gesture imports another
  gesture's module: ` from "./<name>"` with an optional `.js` or `.ts`, on the line that ends the
  statement, in double quotes;
- `examples/uml/src/modules.test.ts`, `importsOf`: `from "./<name>"` in double quotes, with a
  `.ts` stripped but not a `.js`; and, for the dead exports, `import { … } from "./…"` alone.

A fourth reader, `examples/uml/src/comb-source.test.ts`, reads `from` and dynamic `import(` in
either quote, to hold the package diagram to Comb's modules (G-12). It holds no boundary, says that
it parses Comb's source itself, and stays out of this ticket.

Evidence:

- the review of ticket 17 of revision-2026-11-20 (PR #116) found that the gesture test missed an
  import written with an extension, such as `"./node-drag.js"`; cc300199 (PR #117) reworked its
  pattern. `importsOf` of `modules.test.ts` still misses that form: `import { x } from
  "./state-diagram.js"` in `class-diagram.ts` would pass its test.
- ticket 03 of revision-2026-11-20 (PR #109) named in its doubts that imports are read only in the
  form `import { … } from "./…"`; ticket 17 (PR #116) that a gesture which does not name the type
  `Gesture` escapes the test.
- ticket 01 of revision-2026-11-20, open, asks to extend `modules.test.ts` to more generic modules,
  which would widen the copy that misses a form.

Let the boundaries be rows of one reader that knows every form of an import and a re-export the
source files use: rule 6 of `scripts/check-structure.sh` with a table of boundaries (a set of
files, the set they must not import), as the convention *A check's cases are a table* asks, or
one shared reader in TypeScript that the tests call. Which one is the session's choice to settle
with the maintainer: the check is a protected part, and a boundary in it needs no build.

## Acceptance criteria

- [ ] Given a gesture module of `packages/comb/src/interaction/` that imports another gesture's
      module in any form the reader knows (a `.js` or `.ts` extension, single quotes, a statement
      over several lines, `export … from`, a dynamic `import(`), when the checks run, then they
      fail, naming both files.
- [ ] Given a diagram module of `examples/uml/src/` that imports another diagram's module in
      those forms, and `shared.ts` or `activity.ts` importing a diagram's module, when the checks
      run, then they fail, naming both files.
- [ ] Given the rows of the boundaries, when a row's set of files matches none, then the reader
      fails, naming the row (convention *A check fails on what it cannot read*).
- [ ] Given the tree, when it is searched, then no test or check other than the one reader holds
      a pattern of an import statement for a boundary; `comb-source.test.ts`, which holds none,
      is left as it is.
- [ ] Given today's tree, when the checks run, then they pass.

## Read first

- Touches: `scripts/check-structure.sh`, `scripts/test-check-structure.sh`,
  `packages/comb/src/interaction/interaction.test.ts`, `examples/uml/src/modules.test.ts`
- REN-moving-layer-moves-content (the gesture test cites it), ARCH-one-workspace-per-example
  (*Shell*, *Direction*), NUC-checks-are-bash.
- Conventions: *A check's cases are a table*, *A check fails on what it cannot read*, *A self-test
  asserts what it builds*.
- docs/ARCHITECTURE.md, *Holding the shape*.
- Related: docs/plan/revision-2026-11-20/01-a-uml-node-family-is-described-once.md, whose first
  criterion this reader then decides as rows, where it lands first.

## Blocked by

- None (can start immediately)

## Mode

with the human: `scripts/check-structure.sh` and its self-test are protected parts the maintainer
reviews, and where the boundaries live is a choice that bears on every later module rule.
