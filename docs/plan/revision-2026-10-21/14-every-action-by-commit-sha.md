# Ticket: Every workflow references its actions by commit SHA, and the sensor requires it

## What to build

ADR-0017 references every action in `.github/workflows/` by its full commit SHA, and its
*Enforcement* runs `scripts/sensor-action-refs.sh --require sha` in `scripts/check-all.sh` and in
the `sensors` job. The **Benchmark** and **Mutation testing** workflows follow it. `checks.yml`
does not: its six checkouts name `actions/checkout@v7`, and its header says that only "its
actions outside actions/*" are pinned by commit SHA, citing ADR-0017 for a rule the ADR does not
make. The sensor runs without `--require` and reports "mixed forms — 6 on a major tag, 0 on a
full version tag, 6 on a commit SHA" on every run. ADR-0017 names this conversion as its
follow-up, and no ticket carries it.

The six checkouts name the SHA that `benchmark.yml` and `mutation.yml` already use, with its
version in a trailing comment. The header of `checks.yml` says what ADR-0017 decides. The sensor
runs with `--require sha` where the *Enforcement* says, beside a comment that cites ADR-0017.

## Acceptance criteria

- [ ] Given `.github/workflows/`, when `scripts/sensor-action-refs.sh --require sha` runs, then
      it passes, and it fails once a `uses:` line names a tag (`Verifies: ADR-0017`).
- [ ] Given `scripts/check-all.sh` and the `sensors` job of `checks.yml`, when they run, then
      each runs the sensor with `--require sha` after its self-test.
- [ ] Given the header of `checks.yml`, when it is read beside ADR-0017, then it states the same
      rule.

## Read first

- ADR-0017 in full; ADR-0007 (the CI workflows are a protected part); ADR-0008.
- `.github/workflows/checks.yml`, `.github/workflows/benchmark.yml` (the golden path of a pinned
  checkout), `scripts/sensor-action-refs.sh`, `scripts/check-all.sh`, `.github/dependabot.yml`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes CI workflows, a protected part of ADR-0007, and implements the
proposed ADR-0017, whose review is the maintainer's.
