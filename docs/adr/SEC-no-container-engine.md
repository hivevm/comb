# SEC-no-container-engine: The work inside the Dev Container reaches no container engine

- **Status:** 🟢 accepted
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** `.devcontainer/`, every test that would need a service or a container, `scripts/check-container.sh`, `scripts/test-check-container.sh`, and `.github/workflows/devcontainer.yml`

## Context

Comb is a library for the browser with no database or service of its own; its browser tests run
Chromium inside the Dev Container ([DEV-bun-vite-and-wasm-pack](DEV-bun-vite-and-wasm-pack.md),
[DEV-container-adds-bun-and-rust](DEV-container-adds-bun-and-rust.md)). Nothing in the work needs a
container engine.

## Decision

We will keep the Dev Container without any container engine, neither the host's
([NUC-container-hides-host-daemon](NUC-container-hides-host-daemon.md)) nor one inside it, and
without Compose services.

**Out of scope:** nothing beyond the sentence above.

## Alternatives considered

None — cheap to reverse.

## Sources / Prior art

None — cheap to reverse.

## Consequences

None — cheap to reverse.

## Enforcement

`scripts/check-container.sh` fails when `.devcontainer/devcontainer.json` names a Feature whose id
contains `docker` or `podman`, or a `dockerComposeFile`. Its self-test
`scripts/test-check-container.sh` cites this ADR with `Verifies: SEC-no-container-engine`.
