# ADR-0030: A veto that changes the graph during its call ends its gesture with nothing done

- **Status:** 🟡 proposed
- **Date:** 2026-10-25
- **Deciders:** Markus Brigl
- **Applies to:** the vetoes `canConnect` and `canDelete` as `packages/comb/src/api/` and `packages/comb/src/interaction/` ask them

## Context

ADR-0023 lets the host application refuse a connection (`canConnect`) or a deletion (`canDelete`)
the user makes, synchronously, in the input event that ends the gesture. A veto is the host's
code, and it may call `Comb` while it runs: add an edge, remove a node, update one.
`docs/CONVENTIONS.md` (*Host code may change the graph*) asks that after host code returns, Comb
decide from the graph as it stands then. ADR-0023 does not say what a veto that changed the graph
means, and the two vetoes answered differently:

- the deletion did nothing, silently, where `canDelete` changed the graph, since what it was asked
  about may no longer be what would go;
- the connection added the edge whatever `canConnect` did. One that removed the source or the
  target threw `missingNode` from the pointer's release, and one that added an edge between the two
  itself got a second edge from the user's gesture beside its own, which ADR-0024 (*Compatible*)
  would not have let the user make.

A veto is asked about one proposal: these nodes, these edges, these sides. Once the graph has
changed under it, its answer is an answer to a question about another graph. Q-7 asks that a
change through the public interface naming a node the graph does not hold be refused with a typed
error; the user's gesture is no call of the host's, and the host's own call that changed the graph
has already succeeded.

## Decision

We will end a gesture with nothing done, and no error, where its veto, `canConnect` or `canDelete`,
changed the graph during its call, whatever the veto returned.

- **Changed:** a veto changed the graph where the store recorded a change of the graph between the
  veto's call and its return; a change of the selection or the viewport is none.
- **Nothing done:** no edge is added and nothing is removed by the gesture, no change of the
  user's is delivered, and nothing is thrown, even where `canConnect` returned an identifier or
  `canDelete` returned `true`. What the veto did through `Comb` stands, and was delivered as that
  call delivers it.
- **One rule:** both vetoes are asked from one module of `api`, beside the user's edits, and the
  rule is written there once.
- **A veto that throws** keeps ADR-0023's behaviour: the gesture is refused, ended, and the error
  thrown on, whether or not the veto changed the graph before it threw.

**Out of scope:** a veto that changes the selection or the viewport, which leaves the gesture to
its answer; the host's own calls, which no veto is asked about.

## Alternatives considered

- **Re-check and carry out against the changed graph** — the connection would add its edge where
  both nodes still exist and no edge joins them, and the deletion would recompute what goes. The
  veto would then have allowed something it was never asked about: a deletion that now takes an
  edge the veto added, a connection beside an edge the veto drew between the same nodes. Asking the
  veto again could loop with a veto that changes the graph each time.
- **Throw a typed error** — a `GraphDataError` from the input event, as a refused identifier is
  thrown (ADR-0023). The host's call that changed the graph succeeded, and the host chose to change
  it; reporting that as its mistake makes every host that edits in a veto handle an error for a
  case it made on purpose. The deletion already ends silently, so this would change behaviour a
  host may rely on.

## Sources / Prior art

- ADR-0023 (*Vetoes*, *The user's edge*, *Deleting*), ADR-0024 (*Compatible*), ADR-0028 (*What
  the bridge cannot see*); `docs/CONVENTIONS.md` (*Host code may change the graph*).
- The deletion's behaviour before this ADR, in `packages/comb/src/interaction/delete.ts`, which
  compared the store's change before and after `canDelete`.

## Consequences

- Positive: a host that edits the graph in a veto gets exactly the graph it made, for both
  gestures, and no error from the page.
- Positive: the rule after a veto stands in one place, so a third veto would take it as it is.
- Negative / trade-offs: a host that changes the graph in a veto and returns an identifier or
  `true` sees its answer ignored without being told; the change it made through `Comb` is how it
  learns what happened.
- Negative / trade-offs: any change of the graph counts, also one unrelated to the proposal, such
  as an `updateNode` of a third node.
- Follow-ups: whether a veto should be told that its answer was dropped, should a host ask for it.

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0030`.

- Browser tests in `examples/metric-tree/e2e/connect.spec.ts` release a connection with a
  `canConnect` that removes the target and returns an identifier, and assert that no edge is added,
  no change of the user's is told, and no error reaches the page; and with a `canConnect` that adds
  an edge between the two nodes itself and returns another identifier, and assert that only its own
  edge exists.
- The browser test in `examples/metric-tree/e2e/delete.spec.ts` whose `canDelete` adds an edge and
  returns `true`, and the unit tests of the deletion in `packages/comb/src/interaction/`, assert
  that nothing is deleted.
