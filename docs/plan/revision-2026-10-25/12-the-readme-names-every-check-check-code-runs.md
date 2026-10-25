# Ticket: The README and `check-code.sh` name every check it runs

## What to build

`README.md` (**Build, Test & Run**, ADR-0008) lists what `scripts/check-code.sh` runs as the
structural check, the dependency check, and the self-test of the engine check; `check-code.sh` also
runs `scripts/check-overview.sh` after its self-test, which the overview's *Holding the shape*
names and the README does not. `check-code.sh`'s closing line, "Structure, build, lint, tests, and
bundle budget passed.", leaves out the dependencies and the overview. The header of
`scripts/check-engine.sh` breaks a sentence over a stray line ("It passes silently. A root" /
"without …").

Name the overview check in the README's sentence and in the closing line, and mend the header.

## Acceptance criteria

- [ ] Given the README's **Build, Test & Run** and `check-code.sh`, when they are read side by side,
      then each check `check-code.sh` runs is named in the README in the order it runs.
- [ ] Given `scripts/check-code.sh`, when it passes, then its closing line names every part it ran.
- [ ] Given `scripts/check-docs.sh`, when it runs, then it passes.

## Read first

- ADR-0008 (*Build, Test & Run*), ADR-0002.
- `README.md` (**Build, Test & Run**), `scripts/check-code.sh`, `scripts/check-engine.sh`;
  `docs/ARCHITECTURE.md` (*Holding the shape*).

## Blocked by

- None (can start immediately)

## Mode

unattended: a documentation fix read against the script; no part the harness ADR keeps with the
human (ADR-0007), and one revert undoes it. Stop: none beyond the criteria; where the README's
section turns out to be the template's, hand off.
