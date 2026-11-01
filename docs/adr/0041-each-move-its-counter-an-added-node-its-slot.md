# ADR-0041: The graph's structure and what the pointer is over live in a vanilla Zustand store; no coordinate does, and each kind of move is signalled by a counter of its own, an added node by its slot

- **Status:** 🟡 proposed
- **Date:** 2026-11-02
- **Deciders:** Markus Brigl
- **Applies to:** `packages/comb/src/store/`, the state `packages/comb/src/interaction/` keeps between pointer events, and every module that reads or writes the state of the graph or the viewport

## Context

ADR-0037 keeps the graph's structure, what the pointer is over, and the viewport in one store of
`zustand/vanilla`, and every coordinate out of it, each kind of move signalled by a counter of its
own; it has an added node increment `positionsVersion`, the counter of the changes of positions a
kept query does not survive.

ADR-0040 has an edit at the far level keep the query, which the scene can do only where an added
node is not counted with a load: it reads an edit from the slots in which the store's arrays
differ from the ones it drew, and an added node's slot is that signal already.

This ADR restates ADR-0037 with that clause, and supersedes it once accepted, together with
ADR-0040; until then ADR-0037 stays in force as it reads.

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
- **The graph's coordinates:** a drag of nodes writes positions into the engine's buffer; its
  first move names the dragged slots in the store's `dragged`, and each pointer move, which a
  browser delivers at most once a frame, increments `movesVersion`, which a query the scene keeps
  survives (ADR-0036); its release clears `dragged` and increments `positionsVersion`.
  `positionsVersion` counts the changes of positions a kept query does not survive: a load, a
  drag's release, and each move of a label drag. An added node increments none of them: its slot
  in the store's `nodes` is the signal, which the scene compares with the arrays it last drew
  (ADR-0040). No position is copied into the store. The scene compares the counters with the ones
  it last drew.
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
  the engine and redraw the connectors on every move.
- **ADR-0037 as it stands** — an added node increments `positionsVersion`, which the scene cannot
  tell from a load, so an edit at the far level queries the whole view, which ADR-0040 decides it
  does not.
- **ADR-0029 as it stood** — a node drag's every move increments `positionsVersion`, which the
  scene cannot tell from a load, so it queries every frame, which ADR-0036 decides it does not.
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

- ADR-0037, which this restates, ADR-0036, whose drag it follows, and ADR-0040, whose edits it
  follows.
- ADR-0011 and the sources it cites: Zustand without React,
  <https://zustand.docs.pmnd.rs/apis/create-store>; npm `zustand` 5.0.15, MIT; Preact Signals
  core, <https://github.com/preactjs/signals>; npm `@preact/signals-core` 1.14.4, MIT (checked
  2026-10-17).
- `packages/comb/src/store/index.ts` (`Connection`, `pointerVersion`), `interaction/connect.ts`,
  `render/connectors.ts` (`ConnectionLine`), as they stand on 2026-10-25.

## Consequences

- Positive: the store stays small and changes at the pace of edits and of what the pointer is
  over, so subscriptions stay cheap; a connection drag writes one counter a frame.
- Positive: where each coordinate lives, and why there are three counters, is in the record.
- Negative / trade-offs: the state of the graph is split in three places, the store, the engine's
  buffers, and interaction's point; the counters are the contract between them, and a write that
  forgets one leaves the canvas stale.
- Negative / trade-offs: `render` takes the pointer's point as an argument of each render beside
  the store's view.
- Follow-ups: whether actions are batched into one notification when the host application loads
  a large graph (Q-2).

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0041`; the tests that cite ADR-0037 move to it
when it is accepted.

- A test in `packages/comb` adds a node and asserts that `positionsVersion` stays and the node's
  slot is in the store's `nodes`.

- A test in `packages/comb` drags a node across many frames and asserts that the store's graph
  object stays the same reference while `movesVersion` rises once per frame, `positionsVersion`
  stays, and `dragged` names the node's slot, and that the release clears `dragged` and
  increments `positionsVersion` (`packages/comb/src/interaction/interaction.test.ts`).
- A test in `packages/comb` drags a connection across the empty canvas, one move a frame, and
  asserts that each move writes `pointerVersion` alone while the line follows the pointer
  (`packages/comb/src/interaction/interaction.test.ts`).
- A browser test drags a connection and asserts that it neither queries the engine nor redraws the
  connectors per move (`examples/metric-tree/e2e/connect.spec.ts`).
- The structural check of ADR-0028 fails when `render` reaches a writing action, and
  `scripts/check-dependencies.sh` fails when `packages/comb` depends on a store library other than
  `zustand`.
