# ADR-0016: The repository holds no secrets and relies on GitHub's baseline

- **Status:** 🟢 accepted
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** the repository, its CI workflows, and the repository settings

## Context

Comb is not published to a package registry yet, and its build and tests need no credential
([Threats](../SPECIFICATION.md#threats--forbidden-actions)).

## Decision

We will keep no secret in the repository or in its Actions secrets, and rely on GitHub's secret
scanning with push protection as the only guard.

**Out of scope:** the credentials of a future release to a registry, which a revision of this ADR
takes up together with that release.

## Alternatives considered

None — cheap to reverse.

## Sources / Prior art

None — cheap to reverse.

## Consequences

None — cheap to reverse.

## Enforcement

**Not mechanically decidable:** without a scanner, the rule is review and push protection, a
repository setting outside the tree. No workflow references `secrets.` other than the
`GITHUB_TOKEN`, which review holds.
