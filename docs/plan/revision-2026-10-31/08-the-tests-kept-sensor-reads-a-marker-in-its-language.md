# Ticket: The tests-kept sensor reads a marker in its own language

## What to build

`scripts/sensor-tests-kept.sh` reports a skip or focus marker on any added line of any file
(`MARKERS`, line 29), JavaScript's `fit(` among them. The bridge crate's Rust calls a method
`.fit(` (`crates/engine-wasm/src/graph_data.rs:715`, 3325, 3328), so the sensor reported a
focused test on five pull requests of the node-content plan in a row, tickets 02 to 06 (merges
f89a12e, 0c758c1, daa34fc, bc452d2, ac8a04a), and each pull request explained the same false
positive. A sensor that reports the same nothing on every pull request teaches its reader to
skip its report.

Each marker is read only in files of the toolchain it belongs to, by extension: JavaScript's and
TypeScript's in `.js`, `.ts`, and their kin, Rust's `#[ignore]` in `.rs`, and so on for the
toolchains the catalogue entry *Toolchain* names. The sensor is the template's (ADR-0005), so the
fix goes upstream to hivevm/nuc, the sensor and its self-test together, on the maintainer's
decision, and this project takes it with the next template release, as ticket
docs/plan/revision-2026-10-24/22-a-second-revision-on-one-day-resets-the-count.md does for the
revision sensor.

## Acceptance criteria

- [ ] Given an added line `&& self.content.fit(count)` in a `.rs` file, when the sensor runs,
      then it reports no marker.
- [ ] Given an added line `fit("x", () => {})` in a `.ts` file, and `#[ignore]` in a `.rs` file,
      when the sensor runs, then it reports each.
- [ ] Given the self-test (`scripts/test-sensor-tests-kept.sh`), when it runs, then it plays both
      cases in a temporary repository, beside the cases it holds.

## Read first

- ADR-0005, ADR-0008 (the sensor's mention), ADR-0002; `scripts/sensor-tests-kept.sh`,
  `scripts/test-sensor-tests-kept.sh`, `.agents/skills/propose-adr/concepts/toolchain.md`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the sensor and its self-test are `scripts/sensor-*.sh` and
`scripts/test-sensor-*.sh`, protected parts of ADR-0007, and the template's (ADR-0005), whose fix
goes upstream.
