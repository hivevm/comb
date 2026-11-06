# Ticket: G-12 asks for no refusal that cannot arise

## What to build

A drafted change of G-12 in `docs/SPECIFICATION.md` for the maintainer to land
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). G-12 says that "a connection adds a
relationship, which the example refuses where UML does not allow it". The rules of the UML
example refuse nothing, and by the maintainer's decision during docs/plan/uml-example they
implement no refusal that cannot arise:

- The example's Comb allows loops, for the state diagram (docs/plan/state-diagram, ticket 03),
  so its connect gesture offers one in the class and the package diagram too; `Diagram.allows`
  in `examples/uml/src/diagram.ts` refuses every edge of a node with itself in the veto before
  it asks the rules, so a generalization or realization of a node by itself never reaches them.
- A class and a package never share a diagram, so no connection joins them.

`examples/uml/src/rules.test.ts` cites G-12 and decides that every combination is allowed, the
opposite of what the clause asks. The palette also drops an abstract class, which G-12 does not
name.

Proposed text, replacing the last sentence of G-12:

> A palette adds classes, interfaces, abstract classes, and packages; a connection adds a
> relationship of the diagram's default kind, an association between classes and a dependency
> «use» between packages; and the sidebar edits the selected node or edge.

The alternative is to keep the clause and name a refusal that can arise, which the rules of
`examples/uml/src/rules.ts` then implement; the later spec that brings use case, activity, and
state diagrams may need one.

Accepted ADRs whose basis the change may move, for the maintainer to judge: ADR-0030 cites G-12
for the existence of `examples/uml` alone, which the change keeps; ADR-0024 decides the veto
`canConnect`, which the example keeps calling to name each connection. In the drafting session's
reading neither moves; an agent does not judge that alone.

## Acceptance criteria

- [ ] Given the drafted text above, when the maintainer decides, then G-12 either reads as
      proposed, landed by the maintainer, or keeps a refusal that the maintainer names as one that
      can arise, and this ticket records which.
- [ ] Given the decision, when it lands, then ticket 02 of this directory, which drops the rules
      that refuse nothing, is kept (G-12 asks for no refusal) or rewritten to implement the named
      refusal.

## Read first

- Touches: `docs/SPECIFICATION.md`
- G-12 in `docs/SPECIFICATION.md`; the merge commits of tickets 03 and 04 on feat/dev (de82155,
  fa00a33), section *Doubts*.
- `examples/uml/src/rules.ts`, `examples/uml/src/rules.test.ts`, and the convention *The UML
  example's rules of connection are a table of what they refuse*.

## Blocked by

- None (can start immediately)

## Mode

with the human: a change of the specification is the maintainer's to land, and which ADRs it
moves is the maintainer's to judge ([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7).
