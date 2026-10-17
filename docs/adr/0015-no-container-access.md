# ADR-0015: The work inside the Dev Container reaches no container engine

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** `.devcontainer/`, and every test that would need a service or a container

## Context

Comb is a library for the browser with no database or service of its own; its browser tests run
Chromium inside the Dev Container (ADR-0008, ADR-0014). Nothing in the work needs a container
engine.

## Decision

We will keep the Dev Container without any container engine, neither the host's (ADR-0004) nor
one inside it, and without Compose services.

**Out of scope:** nothing beyond the sentence above.

## Alternatives considered

None — cheap to reverse.

## Sources / Prior art

None — cheap to reverse.

## Consequences

None — cheap to reverse.

## Enforcement

A check fails when `.devcontainer/devcontainer.json` names a Feature whose id contains `docker`
or `podman`, or a `dockerComposeFile`. It cites this ADR with `Verifies: ADR-0015`.
