# ADR-0008: TypeScript with Bun, Vite, Playwright, ESLint, and Prettier; Rust with wasm-pack, cargo test, clippy, and rustfmt

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** `package.json`, `bun.lock`, `Cargo.toml`, the lint and formatter configurations, `scripts/check-code.sh`, `scripts/check-all.sh`, `.github/workflows/`, and the **Build, Test & Run** section of `README.md`

## Context

The specification fixes two languages: TypeScript for the canvas and Rust compiled to
WebAssembly with wasm-pack for the engine. It makes Bun the package manager, script runner, and
test runner, and lets Node.js run only what does not yet run on Bun
([Constraints](../SPECIFICATION.md#constraints)). It leaves open the bundler, the browser test
runner, the linters, and the sensors that check what an agent wrote.

Several goals need a real browser with WebGL2: the example started from VS Code (G-9), culling
(G-7), and the performance goals Q-1 and Q-2. Playwright drives one. Bun 1.4 (2026-08-20)
announces that Playwright runs on it, test runner and configuration included; Playwright's own
system requirements still name only Node.js 22, 24, and 26. A Bun issue that broke Playwright's
navigation was closed on 2026-09-22, before Bun 1.4.3 (2026-10-10), and other projects report
both working setups and keeping Node.js for Playwright. `bunx` runs an executable whose shebang
names `node` with Node.js unless `--bun` is passed, so the same command can run Playwright on
either runtime.

Q-3 caps the bundle at 300 kB, a number a check can hold on every push. Q-1 and Q-2 are defined
on a reference machine with an integrated GPU, which no CI runner has, so CI can only compare
against earlier measurements.

Bun runs the lifecycle scripts of a dependency only when `package.json` lists it under
`trustedDependencies`, and listing any replaces Bun's default list. The npm package of wasm-pack
fetches its binary in such a script.

The catalogue offers three forms of sensors: the linter's own rules first, one tool per kind, and
mutation testing on a schedule. Comb starts with one maintainer and no code, so the first form
fits; the design revision adds what the mistakes call for.

## Decision

We will build, test, and lint Comb with Bun scripts that run wasm-pack (`--target web`) and Vite
for the build, `cargo test`, `bun test`, and Playwright with Chromium on Bun for the tests, and
clippy, rustfmt, ESLint with typescript-eslint, Prettier, and a bundle-size check for the lint, all
run by `scripts/check-code.sh`.

- **Commands** in the README's **Build, Test & Run**: `bun run build`, `bun run test`,
  `bun run lint`, `bun run dev`, `bun run example`, and `bun run bench`.
- **Runtimes:** every tool runs on Bun through `bunx --bun`, the Playwright test runner included.
  Node.js is the fallback for Playwright alone: the golden path runs its browser tests with
  `bunx --bun playwright test`; if they fail there for a reason in Bun, they run through
  `bunx playwright test` on Node.js, and the golden path records the reason.
- **Dependencies:** `bun install` with the committed `bun.lock`; `trustedDependencies` lists
  exactly the packages whose install scripts the build needs, wasm-pack among them, and nothing
  else.
- **WebAssembly target:** `wasm-pack build --target web`, which Vite loads without a plugin;
  wasm-pack is a development dependency, so `bun.lock` pins its version.
- **Sensors for maintainability:** clippy `too_many_lines` and `cognitive_complexity`, rustc
  `dead_code`, and ESLint `complexity` and `max-lines-per-function`, as errors; the template's
  `scripts/sensor-tests-kept.sh` for removed or skipped tests.
- **Sensor for Q-3:** a check that fails when the gzipped JavaScript and WebAssembly of the
  library bundle, without PixiJS, reach 300 kB.
- **Benchmark:** `bun run bench` measures Q-1 and Q-2 with Playwright. On the reference machine it
  decides against the absolute numbers; in CI it runs as a workflow of its own, weekly and on
  demand, and fails on a regression against the last recorded measurement.
- **Where it runs:** `scripts/check-code.sh` is invoked by `scripts/check-all.sh`, by the
  pre-push hook through it, and by a job of `checks.yml` after the toolchain is set up.

**Out of scope:** the Dev Container that provides the toolchain; dependency-direction,
duplication, and dead-export tools for TypeScript, and mutation testing, which the design revision
adds when a mistake calls for them; how the code is laid out in directories.

## Alternatives considered

- **Node.js with npm and Vitest** — the widest support, Playwright included, but the maintainer
  chose Bun, and `bun test` makes Vitest one dependency too many.
- **Playwright on Bun without a fallback** — no Node.js at all, but Playwright itself does not
  list Bun, and the goals that need a browser would rest on Bun's compatibility alone.
- **Playwright on Node.js until Playwright lists Bun** — the supported path, but a second runtime
  kept for a support statement that Bun's own announcement may already make unnecessary.
- **Vitest run on Bun** — more plugins than `bun test`, but a dependency for what Bun already
  provides.
- **Biome instead of ESLint and Prettier** — one fast tool, but fewer rules, and its complexity
  rules are not among the verified sensors of the catalogue.
- **`wasm-pack --target bundler` with `vite-plugin-wasm`** — the target for bundlers, but it adds
  a plugin for what `--target web` gives without one.
- **One tool per kind from the start** — dependency-cruiser, jscpd, and knip catch real mistakes,
  but with no code yet nothing says which of them this project needs.
- **Benchmark only on the reference machine** — absolute numbers where they count, but nothing
  notices a regression between the maintainer's runs.

## Sources / Prior art

- The *Toolchain* entry of the `propose-adr` concept catalogue and its table of sensors; Birgitta
  Böckeler, *Sensors for coding agents* —
  <https://martinfowler.com/articles/sensors-for-coding-agents.html>.
- Bun, `bunx` and shebangs — <https://bun.sh/docs/cli/bunx>; lifecycle scripts and
  `trustedDependencies` — <https://bun.sh/docs/install/lifecycle>; `bun test` —
  <https://bun.sh/docs/cli/test>. npm `bun` 1.4.3 (checked 2026-10-17).
- Bun 1.4 release notes, *Playwright* — <https://bun.com/blog/bun-v1.4>; Bun issue 41851,
  closed 2026-09-22 — <https://github.com/oven-sh/bun/issues/41851>; npm `bun` 1.4.3 published
  2026-10-10 (checked 2026-10-17).
- Playwright, system requirements — <https://playwright.dev/docs/intro> (checked 2026-10-17).
- Running Playwright on Bun: NixOS Wiki — <https://nixos.wiki/wiki/Playwright>;
  playwright-ruby-client on Bun 1.4 —
  <https://github.com/YusukeIwaki/playwright-ruby-client/pull/393>; BrowserStack —
  <https://www.browserstack.com/guide/bun-playwright>.
- wasm-pack, build targets — <https://rustwasm.github.io/docs/wasm-pack/commands/build.html>;
  npm `wasm-pack` 0.15.0 (checked 2026-10-17).
- Vite, WebAssembly — <https://vite.dev/guide/features.html#webassembly>.
- Playwright — <https://playwright.dev/>; typescript-eslint — <https://typescript-eslint.io/>;
  Prettier — <https://prettier.io/>; Clippy lints —
  <https://rust-lang.github.io/rust-clippy/master/>.

## Consequences

- Positive: one runtime for installing, building, and unit testing, and no install script of a
  dependency runs unless it is listed.
- Positive: every goal that needs a browser has a runner that can decide it, and Q-3 is held on
  every push.
- Positive: one script runs the same checks locally, in the pre-push hook, and in CI.
- Negative / trade-offs: Playwright on Bun rests on Bun's claim, not on Playwright's; a regression
  in either shows as a failing browser test, and the fallback to Node.js stays in reach until the
  golden path has shown it unnecessary.
- Negative / trade-offs: Chromium and the Rust toolchain make the Dev Container and the CI job
  larger and slower to set up.
- Negative / trade-offs: CI measures performance only relatively; a slow regression that stays
  under the threshold of each comparison is caught only on the reference machine.
- Follow-ups: removing Node.js from the Dev Container and CI once the golden path runs Playwright
  on Bun; the threshold for a benchmark
  regression and where measurements are recorded.

## Enforcement

The golden path's tests cite this ADR with a `Verifies: ADR-0008` marker. Check 9 of
`scripts/check-docs.sh` holds the build job, `scripts/check-code.sh`, and the required checks of
the README together. A check fails when `package-lock.json` or `yarn.lock` exists beside
`bun.lock`.
