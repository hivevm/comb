# ADR-0014: The Dev Container builds from a Dockerfile that adds Bun, and takes Rust as a locked Feature

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** `.devcontainer/`, `.vscode/launch.json`, `.vscode/extensions.json`, and the CI job that sets up the toolchain

## Context

The specification asks for a Docker-based Dev Container in VS Code with Bun, Rust stable, and
wasm-pack, and lets Node.js run only what does not yet run on Bun
([Constraints](../SPECIFICATION.md#constraints)). ADR-0008 names what runs: Bun for installing,
building, and testing, the Playwright test runner included, Rust with clippy and rustfmt,
wasm-pack as a development dependency pinned by `bun.lock`, and Chromium for the browser tests.
Nothing of it runs on Node.js. G-9 asks for the example to start from a VS Code launch
configuration and open in the browser.

ADR-0004 keeps the host's container engine out of reach and locks the Features by
`.devcontainer/devcontainer-lock.json`; it leaves the base image, the Features, and the toolchain
to the project. What a Dockerfile installs with its own commands is outside that lock, so the
lock holds only where the toolchain comes as Features. The official Feature for Rust takes a
version, additional targets, and components. No official Feature installs Bun; a community
Feature does, at version 0.0.1. The official `oven/bun` image carries the Bun binary and can be
pinned by digest. The base image the template uses, `mcr.microsoft.com/devcontainers/base:debian`,
can be pinned by digest as well.

The container has no browser window. The example's development server runs inside it; VS Code
forwards its port and can open the forwarded address in the host's browser. The VS Code
extensions for ESLint and Prettier run on the Node.js that VS Code itself ships, not on one in the
container.

## Decision

We will build the Dev Container from `.devcontainer/Dockerfile`, which starts from
`mcr.microsoft.com/devcontainers/base:debian` pinned by digest and copies the Bun binary from
`oven/bun` pinned by version and digest, and take Rust stable with the `wasm32-unknown-unknown`
target as a Feature locked by ADR-0004's lock file, with no Node.js in the container.

- **Dockerfile:** the base image by digest; `bun` and `bunx` copied from
  `oven/bun:1.4.3-debian` by digest; ShellCheck from the base image's Debian archive.
- **Features:** `rust:1` with version `stable`, target `wasm32-unknown-unknown`, and components
  `rust-analyzer`, `rust-src`, `rustfmt`, and `clippy`; `github-cli:1` as before.
- **After creation:** `bun install` from `bun.lock`, then Playwright's installer adds Chromium and
  its system libraries.
- **Extensions:** ESLint, Prettier, rust-analyzer, Even Better TOML, Playwright, and Bun; git
  support is VS Code's own.
- **Example:** `.vscode/launch.json` holds *Example: metric tree*, which runs `bun run example`,
  waits for the development server, and opens its forwarded port in the host's browser.

**Out of scope:** access to containers from inside, a decision of its own; how the lock file and
the digests are refreshed; the CI image, which sets up the same versions by its own means.

## Alternatives considered

- **Node.js 24 as a Feature, as Playwright's fallback runtime** — what this ADR first decided;
  ADR-0008 runs Playwright on Bun without it, so it would only enlarge the container.
- **Everything installed by the Dockerfile** — Rust and wasm-pack by their install scripts; one
  file to read, but outside ADR-0004's lock and with an install script fetched from the network at
  build time.
- **The community Bun Feature** — fits the Features model, but at version 0.0.1 from a single
  author it is a supply-chain risk without a gain over the official image.
- **Bun's install script** — the documented way, but it fetches and runs a script at build time;
  the official image pinned by digest yields the same binary without one.
- **An image built from `oven/bun` as the base** — Bun in place, but the user, sudo, and
  conventions of the Dev Containers base images would have to be rebuilt.
- **wasm-pack installed with `cargo install`** — no npm package, but a long compile on every
  rebuild, and its version outside `bun.lock`.

## Sources / Prior art

- Dev Container Feature for Rust, with its `targets` and `components` options —
  <https://github.com/devcontainers/features/tree/main/src/rust>.
- Docker Hub `oven/bun`, tag `1.4.3-debian`, digest
  `sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b`; Microsoft Container
  Registry `devcontainers/base:debian`, digest
  `sha256:6ee2b4097c75d33e9a94d941577a3286e5d629434fba384688b06daeeaaeac99` (both checked
  2026-10-17).
- Community Bun Feature `ghcr.io/shyim/devcontainers-features/bun`, tag `0.0.1` (checked
  2026-10-17).
- Rust stable 1.99.1 (checked 2026-10-17).
- VS Code, `serverReadyAction` in launch configurations —
  <https://code.visualstudio.com/docs/debugtest/debugging-configuration>.

## Consequences

- Positive: every runtime and toolchain version is pinned: the images by digest, the Feature by
  the lock, the JavaScript tools by `bun.lock`.
- Positive: one JavaScript runtime in the container, and the example starts with one click in
  VS Code and opens in the host's browser.
- Negative / trade-offs: two places pin versions, the Dockerfile and the lock; a digest goes
  stale without a process that refreshes it.
- Negative / trade-offs: the container carries Bun, Rust, and Chromium, and takes minutes to build
  the first time.
- Negative / trade-offs: an editor extension that expects Node.js on the container's `PATH` does
  not find it; none of those listed above is known to.
- Follow-ups: how the digests are refreshed, for instance by Dependabot's Docker ecosystem.

## Enforcement

`scripts/check-devcontainer.sh` holds the Features and the lock of ADR-0004. A check fails when
the Dockerfile's `FROM` or `COPY --from` names an image without a digest, when
`devcontainer.json` builds from anything but `.devcontainer/Dockerfile`, or when it names a
Node.js Feature. A CI smoke test builds the container, runs `bun --version`, `cargo --version`,
and `rustup target list --installed`, asserting the pinned versions and the WebAssembly target,
and asserts that `node` is not on `PATH`. Each cites this ADR with `Verifies: ADR-0014`.
