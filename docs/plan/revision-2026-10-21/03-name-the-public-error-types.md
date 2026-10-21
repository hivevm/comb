# Ticket: Name the types of what Comb's errors carry

## What to build

Q-3 asks for a public interface fully typed in TypeScript. `GraphDataError.problem` is a
`GraphDataProblem` and `EngineSourceError.reason` an `EngineSourceProblem`, but `comb` exports
neither type, and `BridgeError`, which `GraphDataProblem` contains, only through it. A host
application that switches on `problem.kind` writes `GraphDataError["problem"]`. The union a host
sees also holds `slotOutOfRange` and `nonFiniteDelta`, which only `translate` returns, a call no
host makes. The README shows `createComb`'s refusal but not what `load` and `updateNode` throw.

`comb` exports the types of its errors' fields, the union holds what a host can meet, and the
README says what `load` and `updateNode` throw. Whether the hand-written `unknownNode` member of
`GraphDataProblem` stands beside the generated `BridgeError` is the maintainer's open answer on
pull request #24 and is not decided here; this ticket takes that answer as given.

## Acceptance criteria

- [ ] Given a host application's TypeScript, when it imports `GraphDataProblem` and
      `EngineSourceProblem` from `comb`, then it type-checks, and a `switch` on `problem.kind`
      without a `default` covers every kind `load` and `updateNode` can throw.
- [ ] Given the union, when the maintainer has decided, then it holds the kinds `translate`
      alone returns or leaves them out, as the decision says.
- [ ] Given the README's usage, when a host developer reads it, then it names the errors `load`
      and `updateNode` throw.

## Read first

- `docs/SPECIFICATION.md` Q-3, Q-7; ADR-0010 (*Errors*), ADR-0018, ADR-0019, ADR-0007.
- `packages/comb/src/index.ts`, `packages/comb/src/api/index.ts`, `packages/comb/src/api/engine.ts`,
  the README's usage.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the public interface, a protected part of ADR-0007, and the reading
of ADR-0010 it rests on is the maintainer's.
