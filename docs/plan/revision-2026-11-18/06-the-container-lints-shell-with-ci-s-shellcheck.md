# Ticket: The Dev Container lints shell with the ShellCheck CI runs

## What to build

The Dev Container installs ShellCheck from the base image's Debian archive (0.10), and the shell
job of the **Checks** workflow uses the one the GitHub runner ships (0.11). On 2026-11-08 the
self-test of `scripts/check-commits.sh` passed the shell lint in the container and failed it in CI,
where 0.11 reported SC2329, a code 0.10 does not know (f6c062da). The local gate then promises less
than CI holds.

Let both run one version of ShellCheck: the container's pinned to what CI runs, or CI's to what the
container runs, with the shell lint naming the version it ran.

## Acceptance criteria

- [ ] Given the Dev Container and the shell job of `.github/workflows/checks.yml`, when each runs
      `shellcheck --version`, then both name the same version.
- [ ] Given a later bump of that version, when it lands, then one place names it, or a check fails
      where the two differ.
- [ ] Given `scripts/check-container.sh`, when the Dockerfile installs ShellCheck, then the check
      still holds the image pinned by digest and the archive signed.

## Read first

- Touches: `.devcontainer/Dockerfile`, `.github/workflows/checks.yml`, `scripts/check-shell.sh`
- DEV-container-adds-bun-and-rust, NUC-checks-are-bash, NUC-container-hides-host-daemon,
  SEC-actions-pinned-by-sha; the **Holding the shape** part of `docs/ARCHITECTURE.md`.
- The message of f6c062da.

## Blocked by

- None (can start immediately)

## Mode

with the human: the container's supply chain and the workflow's are the maintainer's, and a rebuilt
container is needed to see the result.
