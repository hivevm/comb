# Ticket: Write the checks the binding ADRs name and nothing runs

## What to build

The *Enforcement* sections of the proposed ADRs that bind the modules of *Large graphs* name
checks and tests that do not exist, or exist without the marker that ties them to their ADR.
They are cheap now and owed once the ADRs are accepted, when `scripts/check-traceability.sh`
starts counting them:

- ADR-0008: a check that fails when `package-lock.json` or `yarn.lock` exists beside
  `bun.lock`; no test cites `Verifies: ADR-0008`.
- ADR-0010: a check that fails when `crates/engine-wasm/Cargo.toml` enables tsify's default
  features or depends on `serde_json`; the memory-growth tests of
  `packages/comb/src/bridge/bridge.test.ts` and the malformed-data tests of
  `crates/engine-wasm/src/lib.rs` carry no `Verifies: ADR-0010`.
- ADR-0011: a check that fails when `packages/comb` depends on a store library other than
  `zustand`; `store.test.ts` calls `positionsMoved` twice where the ADR asks for a drag across
  many frames that keeps the graph object's reference while the counter rises once per frame.
- ADR-0012: the bound on display objects is tested at the near and the far level, not at the
  middle level the Enforcement names ("at each level").

## Acceptance criteria

- [ ] Given the tree, when each new check runs, then it passes; given a fixture with the offence
      (a `package-lock.json`, tsify with default features, `serde_json`, a second store
      library), then it fails and names it, in a self-test under `scripts/`.
- [ ] Given the existing tests above, when the ticket closes, then each cites its ADR with a
      `Verifies:` marker, and the ADR-0011 test drags across at least ten frames.
- [ ] Given the example at 1 and at 1,000 copies at the middle level, when the same area is
      shown, then the number of bound display objects is the same within the margin.
- [ ] Given each new check or test, when the rule it holds is broken, then it fails
      (`docs/CONVENTIONS.md`, "Break the feature once").

## Read first

- The *Enforcement* of ADR-0008, ADR-0010, ADR-0011, ADR-0012; ADR-0002 (checks as bash scripts
  with self-tests).
- `scripts/check-structure.sh` and `scripts/test-check-structure.sh`, which the new checks copy.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is `scripts/`, `scripts/check-all.sh`, and the tests named above, and a wrong result
  costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, or when a change would need a decision
  no ADR in force states, the session leaves its state here and hands off.
