# Ticket: The host application hands over the engine

## What to build

ADR-0019: `CombOptions.engine` is required and takes a `Response` or a promise of one, a
`WebAssembly.Module`, or the bytes; `createComb` refuses a missing option, a string, a `URL`, and
a `Request` with a typed error before it touches the host element. `comb` exports the engine as
`comb/engine.wasm`, the library build stops inlining it, and the bundle check measures the
JavaScript and the file and fails on an inlined engine. The example and the benchmark hand over
the engine their bundler emits; the README shows how.

## Acceptance criteria

- [ ] Given no `engine`, a string, a `URL`, or a `Request`, when `createComb` is called, then it
      rejects with the typed error and the host element stays empty (`Verifies: ADR-0019`).
- [ ] Given a `Response`, a `WebAssembly.Module`, or the bytes, when `createComb` is called, then
      the canvas draws.
- [ ] Given the library build, when the bundle check runs, then it finds no
      `data:application/wasm` URL, measures `comb.js` and the engine file against Q-3, and its
      self-test fails a bundle that inlines the engine.
- [ ] Given the example served by Vite, when it starts, then it fetches the engine itself and
      every existing browser test passes.
- [ ] Given the README's usage, when a host developer follows it, then it shows the option with
      Vite's `?url` import and `fetch`.

## Read first

- ADR-0019 (whole), ADR-0018, ADR-0009, ADR-0010.
- `scripts/check-bundle.sh` and its self-test; the example's `main.ts`; `bench/run.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the public interface of Comb, a protected part of ADR-0007, and it
starts only once the maintainer has reviewed ADR-0019
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 4).
