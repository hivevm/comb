# ADR-0031: A number the shell computes is refused as the shell's mistake, never as malformed graph data

- **Status:** 🟢 accepted
- **Date:** 2026-10-25
- **Deciders:** Markus Brigl
- **Applies to:** the refusals of the exports `hit`, `moveLabel`, `query`, and `translate` of `crates/engine-wasm/`, their generated types in `packages/comb/src/bridge/`, and the callers of those exports in `packages/comb/src/interaction/` and `packages/comb/src/render/`

## Context

Some numbers an export of the bridge takes come from no graph data: the shell computes them from
the pointer and the viewport. They are the world point of a hit test and of a label's move, the
size of a screen pixel of a query and of a hit test, and the delta of a move. When one of them is
not finite, the shell made a mistake. The host application handed over nothing wrong.

Today the bridge refuses that one kind of mistake in two ways. `translate` refuses a delta that is
not finite as `TranslateError` `nonFiniteDelta`, in a type of the shell's mistakes beside
`SlotError`. `hit` and `moveLabel` refuse a point that is not finite as `GraphDataProblem`
`malformed`, and `query` and `hit` refuse a pixel the same way. That is the type of every problem
of graph data that the methods of `Comb` throw, and `comb` exports it. The architecture overview
says that the bridge "keeps the refusals of the shell's mistakes in types of their own". For the
point and the pixel, that sentence is false.

ADR-0010 asks every export that receives graph data to return a typed error naming the node,
edge, or field at fault. A point or a pixel is not graph data, so ADR-0010 does not decide how
either one is refused. Q-7 asks that malformed input never crash or hang the host page.

The point refusal shows the cost. It was added at the bridge, and a viewport the host may set put
every screen point beyond any finite world point: an x of 1e306 at a scale of 0.005 is enough.
From then on, every hover and every press threw `malformed` as a page error. The shell now answers
"nothing" for such a point without asking the bridge, and a label drag skips a move to one. The
refusal at the bridge is left as a defence. A host that meets it anyway sees a graph-data error
from an input event, for data it never handed over.

## Decision

We will refuse every number the shell computes and an export cannot take — a point, a pixel, or a
delta that is not finite, and a pixel not above zero — in one generated type of the shell's
mistakes, whose kind names the number, beside `SlotError` and never as a `GraphDataProblem`. The
shell guards each such number before it calls the export, or rests on an invariant it names at the
call, so no refusal of this type is reached from an input event.

**Out of scope:** the shape of `SlotError`, which stays as it is; the refusals of graph data,
which ADR-0010 and ADR-0028 decide; what the shell answers in place of a refused call, which each
caller decides as `targetAt` and the label drag do today.

## Alternatives considered

- **Keep `malformed` for the point and the pixel, as they are** — no change. But
  `GraphDataProblem` then means "anything the bridge refused". The overview's sentence on the
  shell's mistakes stays false. And a host that switches on the problem's kind meets one it can
  do nothing about.
- **Refuse the delta as `malformed` too** — one way, and one type fewer. It has the same
  objection, and it undoes the narrowing of `TranslateError` to `nonFiniteDelta` that the
  maintainer approved on 2026-10-25.
- **Refuse nothing; the core answers nothing for such a point and ignores such a move** — `hit_at`
  answered nothing there before the refusal was added. But `moveLabel` then stored a NaN offset,
  the defect the refusal fixed. A silent ignore also hides a shell mistake that a typed refusal
  shows in a test.
- **A type per export, as `TranslateError` is** — each export names exactly what it refuses. But
  three more generated types would carry one idea, the shell's non-finite number, which one type
  with a kind per number states once.

## Sources / Prior art

- Commits 0abc64e (the refusal of a point at the bridge), 5a58413 (the shell's guard after it
  became a page error), and 7230e6a (`TranslateError` narrowed to `nonFiniteDelta`) of this
  repository.
- ADR-0010 (*Errors*), ADR-0028 (the bridge's refusals of what is not finite), and the
  overview's *Bridge* entry.

## Consequences

- Positive: `GraphDataProblem` means one thing for the numbers the shell computes: none of them is
  refused as one (Q-7, Q-3). A refusal of the shell's mistake reads as one in a test. The
  overview's sentence becomes true. Two refusals stay `malformed`: `query`'s rectangle, which the
  scene builds, when it is not a rectangle the bridge can read, and `hit`'s result when it cannot be
  handed back. Neither number comes from the host, and no call reaches either today: the scene
  always builds a rectangle of four numbers, and a hit is one generated value. They stay
  `malformed`, since a type of their own would name a mistake that does not happen.
- Negative / trade-offs: the bridge's data format changes, and the bridge crate's and the bridge's
  tests that expect `malformed` for a point or a pixel change their expected type. `TranslateError`
  is folded into the new type or kept as its alias, a choice for the implementation.
- Follow-ups: whether each guard in the shell has a test from the host's inputs, beside the one of
  `targetAt`.

## Enforcement

Tests of `crates/engine-wasm/src/lib.rs` hand `hit`, `moveLabel`, `query`, and `translate` a
number that is not finite, and assert the refusal in the type of the shell's mistakes, with its
kind, and that nothing moved. A browser test sets a viewport that puts every screen point beyond
any finite world point, hovers, presses, and drags, and asserts no page error. Both cite this ADR.
