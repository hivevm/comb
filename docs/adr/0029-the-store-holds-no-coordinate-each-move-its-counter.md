# ADR-0029: The graph's structure and what the pointer is over live in a vanilla Zustand store; no coordinate does, and each kind of move is signalled by a counter of its own

- **Status:** 🟡 proposed
- **Date:** 2026-10-25
- **Deciders:** Markus Brigl
- **Applies to:** `packages/comb/src/store/`, the state `packages/comb/src/interaction/` keeps between pointer events, and every module that reads or writes the state of the graph or the viewport

## Context

The specification asks for a lightweight TypeScript store, such as Zustand or signals
([Constraints](../SPECIFICATION.md#constraints)), and for Comb to depend on no UI framework
(Q-3). Both candidates have a framework-free core under the MIT license: `zustand/vanilla` and
`@preact/signals-core`.

What decides Q-1 is not the library but what passes through it. With 50,000 nodes, an immutable
update of every position on every frame of a drag rebuilds a large object for each frame, and a
signal per node keeps 50,000 reactive objects alive. ADR-0010 puts node positions, edge path
points, and culling results into buffers the engine owns. ADR-0011 decided that the store holds
what changes at the pace of the user's edits, and every coordinate stays out of it, "in the
engine's buffers", signalled by "a counter".

Two things have since grown that ADR-0011's text does not say. Connecting (ADR-0024) and hovering
keep state the store holds and ADR-0011 does not list: the node under the pointer, and the
connection the user drags, with its source, side, the node it is over, compatibility, and the
connector a release connects to. And the world point a connection is dragged to is a coordinate
that is no part of the graph and lies in no engine buffer: interaction keeps it, as the maintainer
decided on 2026-10-24 rather than let the store take it once a frame, and signals its moves by a
second counter, `pointerVersion`, beside `positionsVersion`. A reader of ADR-0011 finds the point
outside the engine's buffers and a counter whose value no reader compares, and would take either
for a mistake.

This ADR carries ADR-0011 over and says both. It is meant to supersede ADR-0011; the
`Supersedes` field and the flip of ADR-0011's status are the maintainer's, made in the change that
accepts it, since a status changes only by a human.

## Decision

We will keep the structure of the graph, its attributes, node content, edge appearance, the
selection, the viewport, and what the pointer is over in one store created with `createStore` from
`zustand/vanilla`, and keep every coordinate out of it: the graph's in the engine's buffers, the
pointer's in interaction's own state, each kind signalled to its readers by a counter of its own
that the store increments when it moves.

- **Writers:** `api` and `interaction` change the store through its actions; `render` only reads
  it (ADR-0028).
- **Rendering:** `api` subscribes to the store and schedules at most one render per animation
  frame, however many changes it carries; `whenRendered` resolves once every change made before
  the call is drawn and is part of the public interface. The scene decides itself what changed
  since it last drew (ADR-0027), so no selector narrows the subscription.
- **The graph's coordinates:** a drag writes positions into the engine's buffer and increments
  `positionsVersion` once per pointer move, which a browser delivers at most once a frame; no
  position is copied into the store. The scene compares the counter with the one it last drew.
- **What the pointer is over:** the node under the pointer and the connection the user drags,
  without the point it is dragged to, are written only where one of them changes, so a move that
  changes none writes nothing of them.
- **The pointer's coordinate:** the world point a connection is dragged to is interaction's,
  handed by `api` to each render; a move of it increments `pointerVersion` and nothing else, so
  that the frame it schedules redraws the connection's line without querying the engine or
  redrawing the connectors. The counter is the signal of the move; no reader needs its value.
- **Events to the host application** (G-5) are derived from store changes in `api`, so the host
  application sees one sequence of events whatever caused them.

**Out of scope:** persistence and undo, which the host application owns; batching several actions
into one notification; where a coordinate of a later gesture lives, which follows this decision.

## Alternatives considered

- **ADR-0011 as it stands** — no new record, but its text names the engine's buffers as the one
  home of every coordinate and one counter, and lists none of the pointer's state, so the code
  reads as a deviation.
- **The dragged point in the store** — one place for all state, as before the maintainer's
  decision of 2026-10-24, but a store update per frame of a connection drag, the cost ADR-0011
  rejects for positions.
- **The dragged point in an engine buffer** — the letter of ADR-0011, but the engine derives
  nothing from the point; a buffer and an export for a value only the shell reads.
- **One counter for both moves** — one signal, but a connection drag would have the scene query
  the engine and redraw the connectors on every move, as a node drag must.
- **A notification without a counter** (`set({})`) — the same render, but a write that names no
  field shows in no test of what a move writes; the counter makes the move visible.
- **Signals with `@preact/signals-core`** — fine-grained updates without selectors, but one signal
  per node or edge means tens of thousands of reactive objects, and its benefit, updating exactly
  what changed, is what the counters and the engine's buffers already give the hot path.
- **`render` subscribing with selectors** — each layer would hear only its slice, but the scene's
  render cache already compares what it last drew with the store, and selectors per layer would
  schedule several renders for one change instead of one per frame.
- **A hand-written observable** — no dependency, but it rewrites what `zustand/vanilla` already
  provides in about the same number of lines Comb would have to test and maintain.

## Sources / Prior art

- ADR-0011 and the sources it cites: Zustand without React,
  <https://zustand.docs.pmnd.rs/apis/create-store>; npm `zustand` 5.0.15, MIT; Preact Signals
  core, <https://github.com/preactjs/signals>; npm `@preact/signals-core` 1.14.4, MIT (checked
  2026-10-17).
- `packages/comb/src/store/index.ts` (`Connection`, `pointerVersion`), `interaction/connect.ts`,
  `render/connectors.ts` (`ConnectionLine`), as they stand on 2026-10-25.

## Consequences

- Positive: the store stays small and changes at the pace of edits and of what the pointer is
  over, so subscriptions stay cheap; a connection drag writes one counter a frame.
- Positive: where each coordinate lives, and why there are two counters, is in the record.
- Negative / trade-offs: the state of the graph is split in three places, the store, the engine's
  buffers, and interaction's point; the counters are the contract between them, and a write that
  forgets one leaves the canvas stale.
- Negative / trade-offs: `render` takes the pointer's point as an argument of each render beside
  the store's view.
- Follow-ups: whether actions are batched into one notification when the host application loads
  a large graph (Q-2).

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0029`; the tests that cite ADR-0011 move to it
when it is accepted.

- A test in `packages/comb` drags a node across many frames and asserts that the store's graph
  object stays the same reference while `positionsVersion` rises once per frame.
- A test in `packages/comb` drags a connection across the empty canvas, one move a frame, and
  asserts that each move writes `pointerVersion` alone while the line follows the pointer
  (`packages/comb/src/interaction/interaction.test.ts`).
- A browser test drags a connection and asserts that it neither queries the engine nor redraws the
  connectors per move (`examples/metric-tree/e2e/connect.spec.ts`).
- The structural check of ADR-0028 fails when `render` reaches a writing action, and
  `scripts/check-dependencies.sh` fails when `packages/comb` depends on a store library other than
  `zustand`.
