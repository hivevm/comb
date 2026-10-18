# Ticket: Decide the public shapes the large-graphs work added

## What to build

A decision for the maintainer, recorded through `propose-adr` in a pull request of ADRs only.
The work added public interface that no ADR decides, though rule 1 of
[`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules)
names a public interface as architecture-relevant and ADR-0007 keeps it with the maintainer:

- `RendererUnavailableError`, exported from `comb`: `createComb` refuses where PixiJS finds no
  WebGL2, where PixiJS would fall back to Canvas 2D. The decision to take: refusal as the
  contract (it keeps Q-1 honest and made a silent fallback visible), or a fallback the host
  application can opt into.
- `whenRendered` and one render per animation frame (`packages/comb/src/api/frames.ts`): render
  scheduling lives in `api` and is part of the interface; ADR-0011 leaves batching out of scope
  and names it a follow-up for Q-2.
- ADR-0011 says `render` "subscribes with selectors"; `render` subscribes to nothing, and `api`
  subscribes to the whole store and schedules a render. Either the clause or the code changes.

## Acceptance criteria

- [ ] Given each shape above, when the maintainer decides, then a proposed ADR or a revision of
      ADR-0011 records it, with the alternative not taken.
- [ ] Given the decision, when it lands, then its pull request holds ADRs only, and any code it
      asks for is a ticket.

## Read first

- ADR-0011 in full, ADR-0007 (protected parts), the `propose-adr` skill.
- `packages/comb/src/api/index.ts`, `packages/comb/src/api/frames.ts`, `packages/comb/src/index.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the public interface is a protected part of ADR-0007, and an ADR is the
maintainer's decision.
