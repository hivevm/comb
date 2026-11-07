# Ticket: G-13 names node shapes, docking on the outline, and loops

## What to build

A drafted change of `docs/SPECIFICATION.md` for the maintainer to land
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). The feature spec
docs/plan/state-diagram, closed by the design revision of 2026-11-07, drafted G-13 and an
amendment of G-12 and of the assumption about connectors. Its seven tickets merged; no part of
the specification changed, and no test cites G-13. Its text lives on here and in the history of
`docs/plan/state-diagram/spec.md`.

1. **G-13, new, after G-12** (the spec's draft, unchanged):

   > **G-13** — When the host application sets a node's node shape (a rectangle, a rounded
   > rectangle, an ellipse, a circle, a ringed circle, a diamond, or a bar), the system shall draw
   > the node in that node shape, hit it within its outline, and lay its content out inside it.
   > When the host application lets an edge dock on the outline, the system shall end the edge
   > where the line towards its other end crosses the node's outline, for any number of edges on
   > one node. When the host application allows loops, the system shall accept an edge from a
   > node back to itself, from `addEdge` and from the user's connection, and draw it as a loop on
   > one side of the node.

2. **G-12, amended.** Its sidebar switches between three UML diagrams. Proposed sentence after
   the package diagram's: "A state diagram of a Comb's life shows each state in the node shape UML
   gives it, an initial state, a final state, and a choice among them, and each transition as an
   edge docked on the outline, labelled by its event." The palette's sentence adds states, initial
   and final states, and choices. The clause "a connection adds a relationship, which the example
   refuses where UML does not allow it" now names refusals that arise: `examples/uml/src/rules.ts`
   refuses a transition into an initial state, one out of a final state, and every loop but a
   state's (state-diagram tickets 03 and 04), so the draft keeps it. It folds in the withdrawn
   ticket revision-2026-11-06/01, whose premise, that the rules refuse nothing, those tickets made
   false; its alternative, dropping the clause for "a connection adds a relationship of the
   diagram's default kind, an association between classes and a dependency «use» between
   packages", is the maintainer's to weigh instead. The palette also drops an abstract class,
   which G-12 should name. `examples/uml/src/rules.test.ts` cites G-12; it is checked against the
   text landed.

3. **G-3, amended.** "releases over a compatible connector of another node" no longer holds where
   the host application allows loops: the gesture offers the source's own other connectors
   (`connectionOver` in `packages/comb/src/interaction/connect.ts`). Proposed: "of another node,
   or of the same node where the host application allows loops".

4. **The assumption** "Every edge connects one connector of a node to one connector of another
   node" (*Assumptions*): an end docked on the outline joins no connector, and a loop joins one
   node. Proposed: "Every edge joins two ends, each at a connector of a node or on its outline;
   there are no hyperedges and no edges without both ends. An edge may join a node to itself."

5. **Q-4's "from the source connector"** measures a dash pattern along the path from a connector.
   Proposed: "from the path's source end".

Accepted ADRs whose basis the change may move, for the maintainer to judge:
ADR-0031 and ADR-0032 cite G-13 as drafted in the spec, and ADR-0031 cites the assumption's
amendment, so landing them confirms their basis; ADR-0013 names G-3 for the connection's start,
which the change keeps; ADR-0030 cites G-12 for the existence of `examples/uml` alone, and G-3
for the connector hit tests. In the drafting session's reading none moves; an agent does not
judge that alone. ADR-0033, proposed, cites Q-1 and Q-2 for the shaped graph, which the change
leaves as they are.

Once G-13 lands, the tests that decide it cite it: the node-shape, docking, and loop tests that
cite ADR-0031 and ADR-0032 today, among them `examples/metric-tree/e2e/node-shapes.spec.ts` and
the loop tests of `examples/metric-tree/e2e/add-edge.spec.ts`.

## Acceptance criteria

- [ ] Given the drafts above, when the maintainer decides, then `docs/SPECIFICATION.md` carries
      G-13, G-12, G-3, the assumption, and Q-4 as landed by the maintainer, or this ticket records
      which draft was declined and why.
- [ ] Given G-13 landed, when `scripts/check-traceability.sh` runs, then at least one test cites
      G-13 with a `Verifies:` marker, added in the change that lands it or in a ticket it files.
- [ ] Given G-12 landed, when `examples/uml/src/rules.test.ts` is read, then what it decides
      matches G-12's text about refusals.

## Read first

- Touches: `docs/SPECIFICATION.md`, `examples/uml/src/rules.test.ts`
- G-3, G-12, Q-4, and *Assumptions* in `docs/SPECIFICATION.md`.
- `git show 4192d2e:docs/plan/state-diagram/spec.md`, *Goals served*.
- The merge messages of the state-diagram tickets, their lines "G-13 is not in the
  specification": `git log --merges --grep='Merge ticket/state-diagram'`.
- `examples/uml/src/rules.ts` and `rules.test.ts`; the withdrawn ticket revision-2026-11-06/01:
  `git log --diff-filter=D -- docs/plan/revision-2026-11-06/`.

## Blocked by

- None (can start immediately)

## Mode

with the human: a change of the specification is the maintainer's to land, and which ADRs it
moves is the maintainer's to judge ([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7).
