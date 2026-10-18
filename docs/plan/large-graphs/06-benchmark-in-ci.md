# Ticket: Catch performance regressions in CI

## What to build

A workflow of its own, weekly and on demand, runs the benchmark of ticket 01 on a GitHub runner
and fails when a number regresses beyond a set margin against a recorded baseline. The
maintainer updates the baseline deliberately, in a pull request that says why.

## Acceptance criteria

- [ ] Given the workflow, when it is started on demand, then it runs the benchmark at 50,000 nodes
      and uploads its JSON as an artefact.
- [ ] Given a recorded baseline, when a run's p95 frame time or time to first frame exceeds it by
      more than the margin, then the workflow fails and names the number.
- [ ] Given the workflow file, when the action-references check runs, then every action outside
      `actions/*` is pinned by commit SHA (ADR-0017).
- [ ] Given `README.md`, when the ticket closes, then it says how to run the benchmark and how the
      baseline is updated.

## Read first

- ADR-0008 (benchmark in CI as a workflow of its own), ADR-0017 (action references), ADR-0016
  (no secrets).
- `.github/workflows/checks.yml`, whose `code` job sets up the same toolchain.

## Blocked by

- docs/plan/large-graphs/01-benchmark.md

## Mode

with the human: it adds a CI workflow, a protected part of ADR-0007, and the margin is the
maintainer's to set.
