# Ticket: The UML diagrams of Comb are held to Comb's source

## What to build

The UML example draws Comb itself, from data written by hand that nothing holds to the code:

- `examples/uml/src/package-diagram.ts` lists eleven dependencies, "read from
  `packages/comb/src` without its tests" and from `crates/engine-wasm/Cargo.toml`. A module that
  gains or loses an import of another changes none of them.
- `examples/uml/src/class-diagram.ts` lists the operations of the `Comb` interface of
  `packages/comb/src/api/index.ts` and the fields of `CombOptions`, `NodeData`, `EdgeData`, and
  the rest. A method added to `Comb` is missing from the diagram, as a name missing from the
  overview would be, which `scripts/check-overview.sh` catches for `docs/ARCHITECTURE.md`.

Today both agree with the code (checked by the design revision of 2026-11-06). The diagrams are
the example's claim about Comb, so a drift is a wrong example that no test fails.

Write a test that reads the module imports of `packages/comb/src` (tests excluded) and the
crates' dependencies and compares them with the package diagram's dependencies, and one that
compares the `Comb` interface's members with the class diagram's operations of `Comb`. Where the
test lives is the decision: ADR-0030 lets an example import only Comb's entries, so a test of
`examples/uml/` that reads the library's files by path, not by import, keeps the letter of it;
a check under `scripts/` is a protected part (ADR-0007); a test beside the library knows of an
example. The maintainer chooses.

## Acceptance criteria

- [ ] Given a module of `packages/comb/src` that imports a module the package diagram does not
      show it depending on, when the test runs, then it fails naming both, as a self-test or a
      fixture decides.
- [ ] Given a member of the `Comb` interface that the class diagram's `Comb` does not list, when
      the test runs, then it fails naming the member.
- [ ] Given the tree as it is, when the test runs, then it passes.
- [ ] Given a source the test reads nothing from, when it runs, then it fails, naming the source
      (the convention *A check fails on what it cannot read*).

## Read first

- Touches: `examples/uml/src/package-diagram.ts`, `examples/uml/src/class-diagram.ts`, and the
  test's file where the maintainer places it.
- ADR-0030, *Direction*; ADR-0007, *Protected parts*; `scripts/check-overview.sh`, the prior art
  of a check that reads names from the `Comb` interface.
- Conventions: *A check fails on what it cannot read*, *An oracle owes nothing to the code it
  judges*.

## Blocked by

- None (can start immediately)

## Mode

with the human: where the test lives weighs ADR-0030 against ADR-0007, and a check under
`scripts/` is a protected part.
