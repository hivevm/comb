# ADR-0017: Workflows reference actions by full commit SHA, kept current by Dependabot

- **Status:** 🟢 accepted
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** every `uses:` line under `.github/workflows/`, `.github/dependabot.yml`, `scripts/check-all.sh`, and the `sensors` job of `checks.yml`

## Context

The specification names the build pipeline as an asset and dependencies and the build pipeline
as the supply-chain boundary ([Threats](../SPECIFICATION.md#threats--forbidden-actions)).
ADR-0008 adds actions beyond `actions/*` to set up Bun, Rust, and Playwright, and ADR-0014 a smoke
test that builds the Dev Container. A tag of an action can be moved to other code by whoever
controls its repository, and the next run executes that code without a diff in this repository.

The catalogue offers two forms: a major version tag with Dependabot raising the next major, which
fits first-party actions and few maintainers, and a full commit SHA with a version comment kept
current by Dependabot, which fits third-party actions, a release pipeline, or a token with write
access. The template's workflows reference their actions by major tag, and
`.github/dependabot.yml` already updates the `github-actions` ecosystem monthly.

## Decision

We will reference every action in `.github/workflows/` by its full commit SHA with the version it
carries in a trailing comment, and let Dependabot's `github-actions` updates keep both current.

**Out of scope:** auditing workflows beyond their references, such as zizmor's other audits; the
schedule of Dependabot's updates.

## Alternatives considered

- **Major version tag** — what the template ships, with fixes within a major arriving without a
  pull request; but a moved tag runs unreviewed, and third-party actions join with ADR-0008.
- **pinact instead of Dependabot** — pins and updates the same way, but a tool more, while
  Dependabot is already configured.

## Sources / Prior art

- The *Action references* entry of the `propose-adr` concept catalogue.
- GitHub, *Security hardening for GitHub Actions*, using third-party actions —
  <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions>.

## Consequences

- Positive: every change to the code a workflow runs is a reviewed diff.
- Negative / trade-offs: fixes within a major arrive as Dependabot pull requests to review, not on
  their own.

## Enforcement

`scripts/sensor-action-refs.sh --require sha` runs in `scripts/check-all.sh` and in the `sensors`
job of `checks.yml`, beside a comment that cites this ADR with `Verifies: ADR-0017`; it fails on
any reference that is not a full commit SHA.

**Not mechanically decidable:** that `.github/dependabot.yml` keeps its `github-actions` entry and
that each reference carries its version in a trailing comment; review holds both.
