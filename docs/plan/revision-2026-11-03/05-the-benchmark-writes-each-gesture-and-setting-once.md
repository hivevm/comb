# Ticket: The benchmark writes each gesture and each setting once, and compares the browser or says it does not

## What to build

The bench code in `bench/` has these duplications and misplaced comments:

- In `bench/run.ts`, the drag at the fitted view (the `drag` callback handed to
  `gesturesAtFitted`) repeats `dragGesture` line for line. The pan there is `panGesture` with
  another start point and distance.
- In `bench/compare.ts`, the kind of browser and the slowdown factor are written twice: in
  `setting()`, which a comparison and a median require to agree, and in `measuredWith()`, each with
  its own `cpuThrottle ?? 1`. Commit 0fd9a168 meant to move them into one helper.
- The comment of `measuredWith` says a baseline is compared by the browser an attached run used.
  `setting()` never compares `browser`, so runs of different Chrome versions median and compare
  together. ADR-0028 asks only that the version be recorded. Whether the code or the comment is
  wrong is the human's call.
- The doc comment of `median` stands above `measuredWith`, and the one of "the median of one
  gesture" stands above `usable`. A split left each behind.

Write each gesture once and parameterise what differs. Write the setting once, so that
`setting()` and `measuredWith()` read one definition. Put each doc comment back above its
function.

## Acceptance criteria

- [ ] Given `bench/run.ts`, when it is read, then the fitted view's drag and pan call
      `dragGesture` and `panGesture`, or one function each takes the start and the distance.
- [ ] Given `bench/compare.ts`, when it is read, then the attached browser and the slowdown
      factor are defined in one place, which `setting()` and `measuredWith()` both use.
- [ ] Given two runs of an attached browser with different `browser` versions, when they are
      compared or taken as a median, then the result is the one the human chose, and
      `bench/compare.test.ts` decides it.
- [ ] Given `bench/compare.ts`, when it is read, then each doc comment stands above the function
      it describes.
- [ ] Given the Bun tests of `bench/`, when they run, then they pass.

## Read first

- ADR-0028, ADR-0029, the convention *A timed gesture begins from the same view on every runner*.
- `bench/run.ts`, `bench/fitted.ts`, `bench/compare.ts`, `bench/compare.test.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: whether a different browser version refuses a comparison is a decision the
human makes first. The rest could run unattended once that is answered.
