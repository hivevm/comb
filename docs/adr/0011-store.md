# ADR-0011: The graph's structure lives in a vanilla Zustand store, its coordinates in the engine's buffers

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** `packages/comb/src/store/`, and every module that reads or writes the state of the graph or the viewport

## Context

The specification asks for a lightweight TypeScript store, such as Zustand or signals
([Constraints](../SPECIFICATION.md#constraints)), and for Comb to depend on no UI framework
(Q-3). Both candidates have a framework-free core under the MIT license: `zustand/vanilla` and
`@preact/signals-core`.

What decides Q-1 is not the library but what passes through it. With 50,000 nodes, an immutable
update of every position on every frame of a drag rebuilds a large object for each frame, and a
signal per node keeps 50,000 reactive objects alive. ADR-0010 already puts node positions, edge
path points, and culling results into buffers the engine owns. The store then holds what changes
at the pace of the user's edits, not of the frames: the structure of the graph, attributes, node
content, edge appearance, the selection, and the viewport.

## Decision

We will keep the structure of the graph, its attributes, node content, edge appearance, the
selection, and the viewport in one store created with `createStore` from `zustand/vanilla`, and
keep every coordinate out of it, in the engine's buffers, signalled to its readers by a counter
the store increments when they change.

- **Writers:** `api` and `interaction` change the store through its actions; `render` only reads
  it and subscribes with selectors (ADR-0009).
- **Coordinates:** a drag writes positions into the engine's buffer and increments the counter
  once per frame; no position is copied into the store.
- **Events to the host application** (G-5) are derived from store changes in `api`, so the host
  application sees one sequence of events whatever caused them.

**Out of scope:** persistence and undo, which the host application owns; batching several actions
into one notification.

## Alternatives considered

- **Signals with `@preact/signals-core`** — fine-grained updates without selectors, but one signal
  per node or edge means tens of thousands of reactive objects, and its benefit, updating exactly
  what changed, is what the counter and the engine's buffers already give the hot path.
- **Coordinates in the store** — one place for all state, but an update per frame of a drag
  through an immutable store contradicts Q-1, and ADR-0010 already moves them through buffers.
- **A hand-written observable** — no dependency, but it rewrites what `zustand/vanilla` already
  provides in about the same number of lines Comb would have to test and maintain.

## Sources / Prior art

- Zustand, using it without React — <https://zustand.docs.pmnd.rs/apis/create-store>; npm
  `zustand` 5.0.15, MIT (checked 2026-10-17).
- Preact Signals core — <https://github.com/preactjs/signals>; npm `@preact/signals-core` 1.14.4,
  MIT (checked 2026-10-17).

## Consequences

- Positive: the store stays small and changes at the pace of edits, so subscriptions stay cheap.
- Positive: a familiar library with a small footprint for the bundle budget of Q-3.
- Negative / trade-offs: the state of the graph is split in two places, the store and the engine's
  buffers; the counter is the contract between them, and a write that forgets it leaves the
  canvas stale.
- Follow-ups: whether actions are batched into one notification when the host application loads
  a large graph (Q-2).

## Enforcement

A test in `packages/comb` drags a node across many frames and asserts that the store's graph
object stays the same reference while the counter rises once per frame. The structural test of
ADR-0009 fails when `render` calls a writing action. A check fails when `packages/comb` depends on
a store library other than `zustand`. Each cites this ADR with `Verifies: ADR-0011`.
