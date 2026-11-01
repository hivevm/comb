# Ticket: ADR-0014 and ADR-0015 name the check and the workflow that hold them

## What to build

A decision for the maintainer. `scripts/check-container.sh`, its self-test
`scripts/test-check-container.sh`, and the workflow `.github/workflows/devcontainer.yml` hold
[ADR-0014](../../adr/0014-dev-container-toolchain.md) and
[ADR-0015](../../adr/0015-no-container-access.md): their headers cite both, and the tests cite
them with `Verifies:`. Neither ADR's *Applies to* names them. ADR-0014 names `.devcontainer/`,
`.vscode/launch.json`, `.vscode/extensions.json`, and "the CI job that sets up the toolchain";
ADR-0015 names `.devcontainer/` and "every test that would need a service or a container". So
`scripts/sensor-binding-adrs.sh` lists neither ADR for a change of the check or the workflow:
run over the commit that added them (`03ffd60..ecfe2b8`), it names twenty ADRs, ADR-0002,
ADR-0008, and ADR-0017 among them, and not these two. A session that edits the check reads the
ADRs the sensor lists and misses the two it holds. ADR-0004, by contrast, names its own check,
`scripts/check-devcontainer.sh`.

An accepted ADR's *Applies to* changes only by supersession or in a normalization
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 5). The choice is the maintainer's:
restate the two ADRs now with the paths added, or carry the paths into the next normalization and
leave this ticket until then. This revision proposes no ADR.

## Acceptance criteria

- [ ] Given the choice, when the maintainer makes it, then the restated ADRs are proposed in a
      pull request of ADRs only, or this ticket names the normalization that will carry the paths.
- [ ] Given the record after it, when `scripts/sensor-binding-adrs.sh` runs over a change of
      `scripts/check-container.sh` or `.github/workflows/devcontainer.yml`, then it lists the ADRs
      that decide them.

## Read first

- ADR-0014, ADR-0015, ADR-0004 (its *Applies to* as the model); `docs/adr/README.md`
  (*Mechanics*, *A normalization restates the record*).
- `scripts/sensor-binding-adrs.sh`, `scripts/check-container.sh`,
  `.github/workflows/devcontainer.yml`.

## Blocked by

- None (can start immediately)

## Mode

with the human: ADRs are the maintainer's to decide (`docs/adr/`, a protected part of
[ADR-0007](../../adr/0007-harness.md)), and a normalization runs only on the maintainer's
instruction.
