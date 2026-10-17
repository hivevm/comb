# Ticket: Hold the shape and the bundle budget

## What to build

The checks that keep the shape of ADR-0009 and the budget of Q-3 from eroding: a structural test
that fails when the engine's core depends on a crate that reaches the browser, when a module other
than the bridge imports the WebAssembly package, when the render layer writes to the store, or
when the example imports anything of the library but its entry; and a check that fails when the
gzipped JavaScript and WebAssembly of the library bundle, without PixiJS, reach 300 kB.

## Acceptance criteria

- [ ] Given the tree as it is, when the structural test runs, then it passes, and it cites
      `Verifies: ADR-0009`.
- [ ] Given a fixture in which the core names a forbidden crate, or a module outside the bridge
      imports the WebAssembly package, or the render layer calls a writing action, or the example
      imports a path inside the library, when the structural test runs on it, then it fails and
      names the offence.
- [ ] Given the library bundle, when the bundle check runs, then it prints the gzipped size and
      passes under 300 kB; given a fixture over the budget, it fails. It cites `Verifies: Q-3`.
- [ ] Given `scripts/check-all.sh`, when it runs, then both checks run in it, the structural test
      after its self-test.

## Read first

- ADR-0002 (checks as bash scripts with self-tests, `Verifies:` markers), ADR-0008 (sensors,
  bundle check), ADR-0009 (the rules the structural test holds).
- The existing checks under `scripts/` and their self-tests, which the new ones copy.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides it: the criteria above, each with a fixture;
- its scope is isolated to `scripts/` and the bundle build, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, no bridge format, no validation,
  no CI workflow) and fits under the cap of two;
- a wrong result shows as a red `check-all.sh` on an unchanged tree, undone by reverting the
  change; a green run on the tree plus a red run on each fixture proves it right;
- stop: after two attempts at a criterion that stays red, or when a rule would need a decision
  the ADRs do not state, the session leaves its state on this ticket and hands off.
