# Ticket: Decide on mutation testing

## What to build

A decision for the maintainer, then a revision of the proposed ADR-0008, which leaves mutation
testing out of scope "which the design revision adds when a mistake calls for them". The reviews
of the *Large graphs* tickets found, again and again, tests that passed without the feature they
verified: a reference image with `maxDiffPixelRatio: 0.01` that passed with the dashes removed,
a Q-4 test without backward edges, G-7 tested at one level of detail, a brute-force oracle that
read the engine's own cache, a benchmark that could miss its gesture. The convention "Break the
feature once, and watch its test fail" asks authors to do by hand what a mutation tool does on a
schedule.

The decision to take: whether to add a mutation tool, which (for example `cargo-mutants` for
`crates/engine`, whose geometry carries Q-4 and G-7; a TypeScript tool that runs on Bun is not
known to exist and needs research), where it runs (scheduled workflow, like the benchmark, not
the pre-push gate), and what it fails on. Or to decide against it, and keep the convention.

## Acceptance criteria

- [ ] Given the research, when it is put to the maintainer, then it names for each candidate tool
      whether it runs on this toolchain (Bun, wasm-pack, cargo), its run time on `crates/engine`,
      and the surviving mutants it reports today.
- [ ] Given the maintainer's decision, when it lands, then ADR-0008 is revised in a pull request of
      ADRs only, and a ticket adds the tool, or the decision against it is recorded there.

## Read first

- ADR-0008 (sensors, *Out of scope*), the *Toolchain* entry of the `propose-adr` catalogue.
- `docs/CONVENTIONS.md`, the first two entries.

## Blocked by

- None (can start immediately)

## Mode

with the human: it picks a dependency and may add a CI workflow, both the maintainer's (ADR-0007).
