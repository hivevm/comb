# DEV-container-adds-bun-rust-shellcheck: The Dev Container builds from a Dockerfile that adds Bun and a pinned ShellCheck release, which CI's shell lint runs too, and takes Rust as a locked Feature

- **Status:** 🟡 proposed
- **Date:** 2026-11-25
- **Deciders:** Markus Brigl
- **Applies to:** `.devcontainer/`, `.vscode/launch.json`, `.vscode/extensions.json`, the CI job that sets up the toolchain, the `shell` job of `.github/workflows/checks.yml`, the version line of `scripts/check-shell.sh`, `scripts/check-container.sh`, `scripts/test-check-container.sh`, and `.github/workflows/devcontainer.yml`
- **Supersedes:** [DEV-container-adds-bun-and-rust](DEV-container-adds-bun-and-rust.md)

## Context

[DEV-container-adds-bun-and-rust](DEV-container-adds-bun-and-rust.md) builds the Dev Container
from a Dockerfile, pins its images by digest, takes Rust as a locked Feature, and keeps Node.js
out. It takes ShellCheck from the base image's Debian archive, and leaves the CI image to set up
the same versions by its own means. For ShellCheck, CI has no means of its own: the shell job of
`checks.yml` runs the ShellCheck the GitHub-hosted runner image ships.

The two differ. The container's Debian archive carries ShellCheck 0.10.0. The runner behind
`ubuntu-latest` moved to Ubuntu 26.04 in November 2026, whose package is 0.11.0. On 2026-11-08 the
self-test of `scripts/check-commits.sh` passed the shell lint in the container and failed it in CI,
where 0.11 reported SC2329, a code 0.10 does not know (f6c062da). The local gate of
[NUC-checks-are-bash §6](NUC-checks-are-bash.md) then promises less than CI holds, and the
runner's release moves with its image without a change in this repository.

ShellCheck publishes static binaries for Linux on x86_64 and aarch64 with each GitHub release. The
release ships no checksum file, but GitHub records a SHA-256 digest for each asset of the release,
and a download recomputes it. The binary needs no library and no package manager.

The rest of the predecessor's context stands: the specification asks for a Docker-based Dev
Container in VS Code with Bun, Rust stable, and wasm-pack, and lets Node.js run only what does not
yet run on Bun ([Constraints](../SPECIFICATION.md#constraints)).
[NUC-container-hides-host-daemon](NUC-container-hides-host-daemon.md) locks the Features, and what
a Dockerfile installs with its own commands is outside that lock. No official Feature installs
Bun, and the official `oven/bun` image can be pinned by digest. G-9 asks for the example to start
from a VS Code launch configuration and open in the browser.

## Decision

We will build the Dev Container from a Dockerfile that adds Bun and one pinned ShellCheck
release, which CI's shell lint installs too. We will take Rust as a locked Feature, with no
Node.js.

1. **Dockerfile.** The Dockerfile names `mcr.microsoft.com/devcontainers/base:debian` by digest.
   It copies `bun` from `oven/bun:1.4.3-debian` by digest, and links `bunx` to it.
2. **ShellCheck.** `.devcontainer/install-shellcheck.sh` is the one place that names the
   ShellCheck release.
   - It names the version, 0.11.0, and the SHA-256 of the Linux archive for x86_64 and for
     aarch64.
   - It downloads the archive of the machine's architecture from the ShellCheck release on GitHub.
   - It must check the archive against its SHA-256 before it unpacks anything.
   - It must refuse an architecture it names no SHA-256 for.
   - It installs the binary into the directory its argument names.
3. **Both run it.** The Dockerfile runs the install script into `/usr/local/bin`. The `shell`
   job of `checks.yml` runs it into a directory ahead of the runner's own ShellCheck on `PATH`.
   That job must use no action to install ShellCheck.
4. **Version line.** `scripts/check-shell.sh` prints the version of the ShellCheck it ran.
5. **Verified downloads.** The Dockerfile must fetch nothing from the network by its own command.
   The Dockerfile must install no package from an archive it marks as trusted without a signature.
6. **Features.** The definition takes `rust:1` with version `stable`, target
   `wasm32-unknown-unknown`, and components `rust-analyzer`, `rust-src`, `rustfmt`, and `clippy`.
   It takes `github-cli:1` as well.
7. **After creation.** The container runs `bun install` from `bun.lock`. Then Playwright's
   installer adds Chromium and its system libraries.
8. **Extensions.** The definition names ESLint, Prettier, rust-analyzer, Even Better TOML,
   Playwright, and Bun. Git support is VS Code's own.
9. **Example.** `.vscode/launch.json` holds *Example: metric tree*. It runs `bun run example`,
   waits for the development server, and opens its forwarded address in the host's browser.

**Out of scope:**

- access to containers from inside, a decision of its own;
- how the lock file, the digests, and the ShellCheck release are refreshed;
- the CI image beyond ShellCheck, which sets up the same versions by its own means.

## Latitude

None.

## Alternatives considered

- **CI's ShellCheck pinned to the container's, 0.10.0** — the older release, and the runner
  still ships its own beside it; it lints by codes CI's image has already moved past.
- **ShellCheck from the runner and the container both left to their packages** — the state that
  failed on 2026-11-08; Debian and Ubuntu move their releases apart.
- **A ShellCheck action from the Marketplace** — a third party between the release and the
  job, pinned by SHA, but its own download of ShellCheck is not held by the pin of this
  repository.
- **The ShellCheck image `koalaman/shellcheck` copied with `COPY --from` by digest** — the Bun
  pattern, but CI would need the image too, or a second place that names the version.
- **`ADD --checksum` in the Dockerfile** — Docker verifies the download itself, but CI cannot run
  the Dockerfile's line, so the version would stand in two places.
- **A check that compares two pins** — two places to bump, where one script both read needs no
  comparison.
- **Everything installed by the Dockerfile, the community Bun Feature, Bun's install script, an
  image built from `oven/bun`, Node.js as a Feature, wasm-pack by `cargo install`** — rejected by
  the predecessor for the reasons it gives.

## Sources / Prior art

- ShellCheck release v0.11.0, published 2025-08-04, the latest on 2026-11-25 —
  <https://github.com/koalaman/shellcheck/releases/tag/v0.11.0>.
- The SHA-256 digests GitHub records for its assets, read from
  <https://api.github.com/repos/koalaman/shellcheck/releases> and recomputed from a download on
  2026-11-25:
  - `shellcheck-v0.11.0.linux.x86_64.tar.gz`:
    `b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6`;
  - `shellcheck-v0.11.0.linux.aarch64.tar.gz`:
    `68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc`.
- GitHub's runner images: `ubuntu-latest` is Ubuntu 26.04 from November 2026, which ships
  ShellCheck 0.11.0-2; Ubuntu 24.04 ships 0.9.0-1 —
  <https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md>,
  <https://github.com/actions/runner-images/issues/14748>. The shell job's run of 2026-11-23 on
  `main` reports the image `ubuntu-26.04`, version 20261116.202.1.
- The Dev Container's ShellCheck: `shellcheck --version` names 0.10.0 on 2026-11-25.
- The predecessor's sources, for Bun, Rust, and VS Code:
  [DEV-container-adds-bun-and-rust](DEV-container-adds-bun-and-rust.md).

## Consequences

- Positive: the container and the shell job lint with one release, so a green local lint
  predicts the shell job's.
- Positive: a new runner image no longer moves the shell lint.
- Positive: one file names the version and its digests, and a bump changes that file alone.
- Negative / trade-offs: the container's build and each run of the shell job download about 3 MB
  from GitHub.
- Negative / trade-offs: no bot refreshes the release; a maintainer bumps the version and its two
  digests by hand.
- Negative / trade-offs: a host outside the container lints with whatever ShellCheck it has; the
  version line shows which.
- Follow-ups: how the digests and the ShellCheck release are refreshed.

## Enforcement

- `scripts/check-container.sh` runs in `scripts/check-all.sh` and in `checks.yml`, beside its
  self-test `scripts/test-check-container.sh`. It fails when:
  - the Dockerfile's `FROM` or `COPY --from` names an image without a digest (clause 1);
  - `.devcontainer/install-shellcheck.sh` names no version, or no SHA-256 for x86_64 or aarch64,
    or runs no `sha256sum --check` (clause 2);
  - the Dockerfile does not run the install script, or installs ShellCheck from a package
    (clause 3);
  - a line of the Dockerfile other than a `FROM` or a `COPY`, comments aside, contains a URL
    scheme, `[a-zA-Z][a-zA-Z0-9+.-]*://` (clause 5);
  - a command of a `RUN` runs a program whose base name is `curl` or `wget`, through `sudo` or
    `env` as well, or an `ADD` names a source that starts with `git@` (clause 5);
  - the Dockerfile marks an archive as trusted, or allows an unauthenticated package (clause 5);
  - `devcontainer.json` builds from anything but `.devcontainer/Dockerfile`, or names a Node.js
    Feature.
- The `shell` job of `checks.yml` runs the install script before the shell lint (clause 3).
- The workflow `.github/workflows/devcontainer.yml` builds the container as a smoke test. It runs
  `bun --version`, `cargo --version`, `rustup target list --installed`, and
  `shellcheck --version`. It asserts the pinned Bun, the WebAssembly target, and the ShellCheck
  version the install script names. It asserts that `node` is not on `PATH`.
- The self-test and the workflow each cite this ADR with
  `Verifies: DEV-container-adds-bun-rust-shellcheck`.
- `scripts/check-devcontainer.sh` holds the Features and the lock of
  [NUC-container-hides-host-daemon](NUC-container-hides-host-daemon.md).

**Not mechanically decidable:** that the shell job puts the installed ShellCheck ahead of the
runner's on `PATH` (clause 3). The version line of the shell lint in the job's log shows it, and
review holds it (clause 4). Review holds as well:

- that the install script checks the archive before it unpacks anything, and refuses an
  architecture it names no SHA-256 for (clause 2);
- that no action of the `shell` job installs ShellCheck (clause 3).
