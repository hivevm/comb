# Ticket: The tests refuse an engine built from older sources

## What to build

The engine the TypeScript tests run is generated and untracked: `packages/comb/wasm/` and
`packages/comb/wasm/test-mode/`, written by `bun run build:engine`. Only `scripts/check-code.sh`
builds it before it tests. `bun run test` (the Bun tests and Playwright), Playwright's development
server on 5174, its build on 5175 (`vite build` of the example alone), and
`scripts/check-bundle.sh` run on its own read whatever `wasm/` holds. A session that changes
`crates/` and runs those commands tests the engine of an earlier change: a test meant to go red
in its *Broken once* step stays green, or one goes red for a change that is not there. Nothing
says the build is stale; the one hint, "the engine carries no trap; run `bun run build:engine`",
appears only when the test-mode engine is missing.

Add a check that fails, naming the command to run, when either engine file is older than the
newest of the sources it is built from (`crates/**`, `Cargo.toml`, `Cargo.lock`), and run it
before the tests where `bun run test` and `scripts/check-bundle.sh` start, so that local runs and
CI refuse alike. As every check of `scripts/`, it is a bash script with a self-test
(`scripts/test-check-*.sh`) run by `scripts/check-code.sh` (ADR-0002, ADR-0008). Building the
engine in `bun run test` instead is the alternative: always fresh, but a release build of both
engines before every test run; say in the pull request which was chosen and why.

## Acceptance criteria

- [ ] Given an engine file older than a source of `crates/`, when `bun run test` starts, then it
      fails before any test, naming the stale file and `bun run build:engine`.
- [ ] Given both engine files newer than every source, when `bun run test` starts, then the check
      passes silently.
- [ ] Given a missing engine directory, when the check runs, then it fails with the same advice.
- [ ] Given the self-test, when it runs, then it covers a fresh, a stale, and a missing build in a
      temporary tree; `scripts/check-code.sh` runs it.
- [ ] Given the README's **Build, Test & Run**, when it is read, then its **Test** line says that
      the tests refuse a stale engine, and its sentence on `scripts/check-code.sh` names the order
      the script runs in: the structural and dependency checks with their self-tests, then build,
      lint, and test, then the bundle check (today it says "the first three in order, then the
      structural test").
- [ ] Broken once: `touch crates/engine/src/stroke.rs` after a build makes `bun run test` fail.

## Read first

- ADR-0008 (*Commands*, *Where it runs*); ADR-0002 (checks as bash scripts with self-tests).
- `package.json` (`build:engine`, `test`), `playwright.config.ts` (`webServer`), `README.md`
  (**Build, Test & Run**),
  `scripts/check-code.sh`, `scripts/check-bundle.sh`; a self-test to copy, such as
  `scripts/test-check-mutants.sh`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the check and its self-test are `scripts/check-*.sh` and
`scripts/test-check-*.sh`, protected parts of ADR-0007.
