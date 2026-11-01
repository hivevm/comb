# ADR-0008: TypeScript with Bun, Vite, Playwright, ESLint, and Prettier; Rust with wasm-pack, cargo test, clippy, and rustfmt

- **Status:** 🟢 accepted
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** `package.json`, `bun.lock`, `Cargo.toml`, the lint and formatter configurations, `scripts/check-code.sh`, `scripts/check-all.sh`, `scripts/check-dependencies.sh`, `scripts/check-mutants.sh`, `crates/engine/mutants-missed.txt`, `bench/`, `playwright.config.ts`, `.github/workflows/`, and the **Build, Test & Run** section of `README.md`

## Context

The specification fixes two languages: TypeScript for the canvas and Rust compiled to
WebAssembly with wasm-pack for the engine. It makes Bun the package manager, script runner, and
test runner, and lets Node.js run only what does not yet run on Bun
([Constraints](../SPECIFICATION.md#constraints)). It leaves open the bundler, the browser test
runner, the linters, and the sensors that check what an agent wrote.

Several goals need a real browser with WebGL2: the example started from VS Code (G-9), culling
(G-7), and the performance goals Q-1 and Q-2. Playwright drives one. Bun 1.4 announces that
Playwright runs on it, test runner and configuration included; Playwright's own system
requirements still name only Node.js 22, 24, and 26. A Bun issue that broke Playwright's
navigation was closed before Bun 1.4.3, and other projects report both working setups and keeping
Node.js for Playwright. `bunx` runs an executable whose shebang names `node` with Node.js unless
`--bun` is passed. The project's scaffold ran its whole gate on Bun in a container without
Node.js on 2026-10-17: wasm-pack, `tsc`, ESLint, Prettier, Vite, `bun test`, and
`bunx --bun playwright test` with Chromium.

Bun runs the lifecycle scripts of a dependency only when `package.json` lists it under
`trustedDependencies`, and listing any replaces Bun's default list. The npm package of wasm-pack
fetches its binary in such a script.

Q-3 caps the bundle at 300 kB, a number a check can hold on every push. Q-1 and Q-2 are defined on a
reference machine with an integrated GPU, which no CI runner has, so CI can only compare against
earlier measurements. The **Benchmark** workflow's runs on GitHub runners (Sources) show what such a
comparison has to allow for. The runner varies between workflow runs: two runs on `main` without a
change to the code they measure differed in every number by 13 to 42 %, while the three runs within
each agreed closely, so that numbers compared as they are judge the runner as much as Comb. The CPU
model a run records names the runner's kind; within a kind the numbers repeat, and every runner
reports the same SwiftShader renderer. A reference workload timed in the benchmark's page, a
JavaScript loop, a WebAssembly loop, and a WebGL2 draw of a fixed mesh, does not move with Comb's
numbers in proportion, and between kinds it passes runners whose numbers it does not predict. Every
p95 is a whole number of 60 Hz frames, and every gesture runs out of its time before its last step,
so a faster runner sends more steps and pans further; within a kind neither moved a verdict.

The catalogue offers three forms of sensors: the linter's own rules first, one tool per kind, and
mutation testing on a schedule. A test that passes without the behaviour it names is what
mutation testing finds. cargo-mutants mutates a Rust crate and runs its tests against each
mutant; on `crates/engine` it tries about 540 mutants in roughly half an hour. For TypeScript on
Bun, StrykerJS has no runner of its own; the Bun runners are community packages.

## Decision

We will build, test, and lint Comb with Bun scripts that run wasm-pack (`--target web`) and Vite
for the build, `cargo test`, `bun test`, and Playwright with Chromium on Bun for the tests, and
clippy, rustfmt, ESLint with typescript-eslint, Prettier, and a bundle-size check for the lint, all
run by `scripts/check-code.sh`.

- **Commands** in the README's **Build, Test & Run**: `bun run build`, `bun run test`,
  `bun run lint`, `bun run dev`, `bun run example`, and `bun run bench`.
- **Runtimes:** every tool runs on Bun through `bunx --bun`, the Playwright test runner included;
  no tool of the build, the tests, or the lint runs on Node.js.
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
  decides against the absolute numbers. In CI it runs as a workflow of its own, weekly and on
  demand, three times on a GitHub runner, and fails when the median of a number exceeds the
  baseline of the runner's kind by more than 25 %.
- **Runner kind and baselines:** the kind is the CPU model the run records; the GPU is no part of
  it. Each kind's baseline is a file of its own, `bench/baselines/<kind>.json`, named by the CPU
  model in lower case with every run of characters other than `a`–`z` and `0`–`9` replaced by one
  hyphen and no hyphen at either end (`amd-epyc-7763-64-core-processor.json`). The baseline names
  its CPU model, and a run is compared only with a baseline that names the same. A kind's baseline
  is the median of runs on that kind on `main`, every part of its reference included, and is added
  or changed only in a pull request that says why.
- **Refusals:** a run on a kind without a baseline, or one that names no CPU model, is refused,
  naming the kind, if any, and the kinds that have a baseline; so is a run of another size, mode,
  or GPU than its kind's baseline.
- **Reference gate:** each run also times a fixed reference workload in the same page, after the
  first frame and before the gestures: a JavaScript loop, a WebAssembly loop, and a WebGL2 draw of a
  fixed mesh, which use the browser's JavaScript, WebAssembly, and WebGL2 raster but none of Comb's
  code. The reference is a gate within a kind, not a correction: when a part of the run's reference
  differs from its kind's baseline by more than 25 %, either way, the workflow refuses to compare
  and names the parts, since the runner was not in the state the baseline was taken in. A run
  without a reference is refused against a baseline with one; against a baseline without one the
  numbers are compared and the gate is reported as not checked.
- **What a median keeps:** the median of the runs keeps the CPU model and, for each gesture beside
  its p95, the median of the steps sent and of the frames rendered, and so does a baseline.
- **Mutation testing:** cargo-mutants, at a pinned version, mutates `crates/engine` in a workflow
  of its own, weekly and on demand, and fails when a mutant survives that
  `crates/engine/mutants-missed.txt` does not list. The list shrinks with each change that kills
  a mutant and grows only in a pull request that says why. TypeScript keeps breaking each
  feature once by hand (`docs/CONVENTIONS.md`).
- **Where it runs:** `scripts/check-code.sh` is invoked by `scripts/check-all.sh`, by the
  pre-push hook through it, and by a job of `checks.yml` after the toolchain is set up.

**Out of scope:** the Dev Container that provides the toolchain; dependency-direction,
duplication, and dead-export tools for TypeScript, and mutation testing of TypeScript, which the
design revision adds when a mistake calls for them; how the code is laid out in directories.

## Alternatives considered

The toolchain:

- **Node.js with npm and Vitest** — the widest support, Playwright included, but the maintainer
  chose Bun, and `bun test` makes Vitest one dependency too many.
- **Node.js as Playwright's fallback runtime**, for the case that Playwright fails on Bun — the
  scaffold ran it on Bun without Node.js, so the second runtime would be kept for a failure nobody
  has seen.
- **Playwright on Node.js until Playwright lists Bun** — the supported path, but a second runtime
  kept for a support statement Bun's announcement and the scaffold's run already answer.
- **Vitest run on Bun** — more plugins than `bun test`, but a dependency for what Bun already
  provides.
- **Biome instead of ESLint and Prettier** — one fast tool, but fewer rules, and its complexity
  rules are not among the verified sensors of the catalogue.
- **`wasm-pack --target bundler` with `vite-plugin-wasm`** — the target for bundlers, but it adds
  a plugin for what `--target web` gives without one.
- **One tool per kind from the start** — dependency-cruiser, jscpd, and knip catch real mistakes,
  but with no code yet nothing says which of them this project needs.

Where and against what the benchmark judges:

- **Benchmark only on the reference machine** — absolute numbers where they count, but nothing
  notices a regression between the maintainer's runs.
- **A baseline over several workflow runs**, the median of five weekly runs on `main` — one
  runner's speed weighs less in the baseline, but each comparison is still of one runner's
  numbers, whose speed decides the verdict as much as Comb does.
- **A wider margin sized to the spread between runners** — nothing new to measure, but with
  runners 42 % apart it catches only regressions larger than that.
- **Telling kinds apart by a tighter reference gate** — the JavaScript part alone differs from the
  7763's by 7 % on the 8370C and 12 % on the 9V74, and within each of these three kinds by under 1
  %, but on the 9V45 it spread by 18 % within one workflow run, and a reference that matches does
  not say which baseline applies; the CPU model names the kind exactly.
- **A tighter gate within a kind**, 5 % — the median references of the best-measured kind agreed
  within 2 %, but two kinds have one run with a reference each, too few to size a tighter gate by,
  and a first run 34 % slower in its WebGL2 part did not move the median.

Correcting the numbers by the reference instead of gating on it:

- **Normalising every number by the reference's sum** — would cancel a runner's speed if Comb's
  numbers moved with it, but on four cores the sum rose with the WebGL2 part more than Comb's
  numbers did, so every ratio fell by 15 to 54 % and a first frame twice as slow would pass.
- **Normalising by the reference's parts**, the loops alone or a weighted sum — the loops did not
  move on four cores while Comb's numbers did, so dividing by them raised false alarms of 61 to
  78 %; a weighting fitted to one machine says nothing about another runner.
- **A gate per gesture**, each gesture divided by the part of the reference it follows — holds
  drag and pan within 8 %, but no part predicts pan near and pan middle, which stay 22 to 50 %
  off on the three other kinds.

The shape of a gesture and its margin:

- **A margin of whole frames**, the larger of 25 % and three frames — fits a p95 that comes in
  whole frames, under which 25 % of pan near is two frames, but it changes no verdict of the
  eleven runs: on the 8370C pan near took 5 frames and pan middle 7 frames more than the
  baseline.
- **Every step of every gesture, no time limit** — the same path on every runner and about 120
  frames per gesture, but at the rates measured the gestures of three runs take 19.5 minutes on
  the 7763 and 25 to 28 minutes on the 8370C, past the job's 30, and within a kind the frames
  rendered did not move the p95: pan near on the 9V74 took 10 frames in runs of 77 and of 64
  frames.

Mutation testing:

- **Mutation testing that only reports** — never red, but a report nobody is made to read
  changes nothing.
- **A threshold on the share of mutants caught** — one number, but a new surviving mutant hides
  behind one killed elsewhere.
- **StrykerJS with a community runner for Bun** — would cover TypeScript, but rests on a package
  outside the Stryker project.

## Sources / Prior art

- The *Toolchain* entry of the `propose-adr` concept catalogue and its table of sensors; Birgitta
  Böckeler, *Sensors for coding agents* —
  <https://martinfowler.com/articles/sensors-for-coding-agents.html>.
- Bun, `bunx` and shebangs — <https://bun.sh/docs/cli/bunx>; lifecycle scripts and
  `trustedDependencies` — <https://bun.sh/docs/install/lifecycle>; `bun test` —
  <https://bun.sh/docs/cli/test>. npm `bun` 1.4.3 (checked 2026-10-17).
- Bun 1.4 release notes (2026-08-20), *Playwright* — <https://bun.com/blog/bun-v1.4>; Bun issue
  41851, closed 2026-09-22 — <https://github.com/oven-sh/bun/issues/41851>; npm `bun` 1.4.3
  published 2026-10-10 (checked 2026-10-17).
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
- cargo-mutants — <https://mutants.rs/>, crate `cargo-mutants` 27.1.0 (checked 2026-10-18).
- StrykerJS test runners — <https://stryker-mutator.io/docs/stryker-js/>: Jest, Karma, Mocha,
  Vitest; no runner for `bun test`.
- The **Benchmark** workflow's runs on GitHub runners, 2026-10-18 to 2026-10-21, and the
  reference workload timed in the Dev Container:
  - Runs 39098695116 and 39102498247 on `main`, without a change to the code they measure, ran on
    an AMD EPYC 7763 and an AMD EPYC 9V45 and differed in every number by 13 to 42 %; the three
    runs within each agreed closely.
  - In the Dev Container limited to four cores, a GitHub runner's size, the reference's WebGL2
    part took five times as long as on all 24 cores (58.4 against 303.9 ms), the loops did not
    move, and Comb's numbers took 1.0 to 1.83 times as long. Two runs on all 24 cores measured
    the WebGL2 part at 58.4 and 94.0 ms.
  - The eleven runs ran on four kinds: AMD EPYC 7763 in six, Intel Xeon Platinum 8370C and AMD
    EPYC 9V45 in two each, and AMD EPYC 9V74 in one. Every runner reported the same SwiftShader
    renderer.
  - Within a kind: the six runs on the 7763 agreed within one frame in the median of every
    gesture, pan near took 8 frames in all eighteen of their files, and each part of the median
    reference of the five that recorded one agreed within 2 %; the median references of the two
    runs on the 8370C agreed within 3 %. A first run's WebGL2 part read up to 34 % slower in three
    of the five, and the median of three absorbed it. Pan near on the 9V74 took 10 frames in runs
    of 77 and of 64 frames.
  - Between kinds, the reference passes runners whose numbers it does not predict. Drag and pan
    follow its WebGL2 part (Pearson r = 0.99 over the eight medians with a reference, the run with
    a deliberate slowdown left out); pan near and pan middle do not (0.69 and 0.74, and 0.07 with
    the JavaScript part). Divided by the WebGL2 ratio, pan near and pan middle come to 1.33 and
    1.39 on the 8370C (run 39544445534), 1.50 and 1.32 on the 9V74, and 1.22 and 1.30 on the
    9V45. Run 39544445534 on the 8370C, its WebGL2 part 22 % slower, failed zoom, pan near, and
    pan middle by 42 to 70 % with a change that measured as `main` did on the 7763 (run
    39545410268); run 39545986669 on the 9V74, faster in every part, measured pan near 25 %
    slower.
  - The JavaScript part alone differs from the 7763's by 7 % on the 8370C and 12 % on the 9V74,
    and within each of these three kinds by under 1 %; on the 9V45 it spread by 18 % within one
    workflow run. The 9V45 and the 9V74 have one run with a reference each.

## Consequences

- Positive: one runtime for installing, building, and unit testing, and no install script of a
  dependency runs unless it is listed.
- Positive: every goal that needs a browser has a runner that can decide it, and Q-3 is held on
  every push.
- Positive: one script runs the same checks locally, in the pre-push hook, and in CI.
- Positive: one JavaScript runtime in the Dev Container and in CI.
- Positive: a verdict of the workflow compares a run with the baseline of its own kind, so a
  runner whose numbers the reference does not predict, as pan near on the 8370C and the 9V74,
  is not judged by another kind's numbers, and a run in an unusual state says so instead of
  passing or failing on the runner's speed.
- Negative / trade-offs: Playwright on Bun rests on Bun's claim and the scaffold's run, not on
  Playwright's support; a regression in either shows as a failing browser test, and the way back
  is a revision of this ADR that adds Node.js for Playwright again.
- Negative / trade-offs: Chromium and the Rust toolchain make the Dev Container and the CI job
  larger and slower to set up.
- Negative / trade-offs: CI measures performance only relatively; a slow regression that stays
  under the threshold of each comparison is caught only on the reference machine.
- Negative / trade-offs: a run on a kind without a baseline is refused, not judged; five of the
  eleven runs from 2026-10-18 to 2026-10-21 ran on another kind than the 7763. Each kind needs a run
  on `main` before its first verdict, a kind GitHub adds is refused until then, and every baseline
  is a file to record and keep. Within a kind, a runner whose reference drifts past 25 % is refused,
  not judged. The reference adds a few seconds to each run.

## Enforcement

- The golden path's test, `examples/metric-tree/e2e/example.spec.ts`, cites this ADR with a
  `Verifies: ADR-0008` marker.
- Check 9 of `scripts/check-docs.sh` holds the build job, `scripts/check-code.sh`, and the
  required checks of the README together.
- `scripts/check-dependencies.sh` fails when a lockfile of another package manager
  (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, or `pnpm-lock.yaml`) exists beside
  `bun.lock`; its self-test, `scripts/test-check-dependencies.sh`, cites this ADR.
- `scripts/check-mutants.sh` fails on a surviving mutant that `crates/engine/mutants-missed.txt`
  does not list, and on a run that caught none; the **Mutation testing** workflow runs it, and its
  self-test, `scripts/test-check-mutants.sh`, runs in `scripts/check-all.sh` and `checks.yml` and
  cites this ADR.
- The tests of `bench/compare.ts`, in `bench/compare.test.ts`, cite this ADR and decide how the
  runner gate and the comparison judge given numbers, among them that a run whose CPU model
  differs from the baseline's is refused, naming both kinds, and that a run of the same kind is
  compared.
- Whether 25 % suits the variance within a kind no test decides; the workflow's runs on `main` do.
  On the 7763 they agreed within one frame in every gesture's median.
