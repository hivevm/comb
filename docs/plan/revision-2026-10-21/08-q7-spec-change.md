# Ticket: Draft a change to Q-7 and Q-4: refusals, a valid graph at any viewport, the mesh budget

## What to build

A drafted change to the specification, for the maintainer to decide
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). The tests that cite Q-7 decide more
than its text says, and the work on Q-7 moved past it. The revision of ADR-0012 that holds the
new part of Q-7 also asks for a change of Q-4, drafted below Q-7's.

- `updateNode` with an identifier the graph does not hold throws a `GraphDataError`, and its
  browser test cites Q-7; Q-7 speaks only of graph data, not of a change made through the
  interface.
- The browser tests of refusals assert that the previous graph stays drawn; Q-7 says nothing of
  what a refusal leaves behind.
- ADR-0010 asks the typed error to name the offending node, edge, or field; Q-7 asks only for a
  typed error.
- A value of the wrong type is refused like the three kinds Q-7 names in parentheses.
- Graph data the bridge accepts could trap WebAssembly at its first render after a zoom
  (docs/plan/revision-2026-10-21/16-a-querys-mesh-has-a-budget.md); Q-7 covers malformed data
  only, and the specification states nowhere that a valid graph never crashes the page.

Q-7 today:

> **Q-7** — Robust input: malformed graph data (non-finite coordinates, an edge referring to a
> missing node, a duplicate identifier) never crashes or hangs the host page and never causes a
> WebAssembly panic; the system rejects it with a typed error.

Drafted:

> **Q-7** — Robust input: malformed graph data (a value of the wrong type, non-finite
> coordinates, an edge referring to a missing node, a duplicate identifier), and a change through
> the public interface that names a node the graph does not hold, never crash or hang the host
> page and never cause a WebAssembly panic; the system rejects each with a typed error that names
> what it refused, and keeps the graph it had. Accepted graph data within the limits of a load,
> and every change to it the system accepts, never crash or hang the host page and never cause a
> WebAssembly panic or trap, at any viewport.

The bullet of *Threats & Forbidden Actions* that restates Q-7 follows it:

> The system shall never let graph data, malformed or accepted, crash or hang the host page
> (Q-7).

ADRs: none of the accepted ADRs (0001 to 0006) rests on Q-7 or names it, so the change moves the
basis of none. Of the proposed ones, ADR-0010 (*Errors*) already asks for the naming, and
ADR-0007 keeps the validation that holds the refusals with the maintainer; neither changes for
them. The new sentence rests on three proposed ADRs: the limits of a load of ADR-0009 become the
bound within which a valid graph must not crash the page; ADR-0012's mesh budget, revised for it,
is what holds the sentence at every viewport; and ADR-0010, revised with it, carries the detail
of a query's mesh across the bridge. The budget lives in `crates/engine`, outside the protected
parts of ADR-0007, which name the validation that holds Q-5 to Q-7; whether the budget joins
them is the maintainer's question. The maintainer confirms this reading.

No test decides "hang" by a bound of time, in the sentence Q-7 has today or in the new one;
the traceability of the change lists it as pending.

Q-4 changes with it. The revised ADR-0012 draws a part of a path outside the query's rectangle
as its chord, and past the mesh budget it draws edges in the viewport as their chords, beyond
0.5 px. Q-4 today asks for 0.5 px "at every zoom level" for all that is drawn. The benchmark's
graph does not reach the budget (its largest mesh is a twelfth of it), but a graph of 50,000 long
or curved edges can.

Q-4 today:

> **Q-4** — Geometric accuracy: edge paths and label positions deviate by at most 0.5 px from a
> reference computation at every zoom level.

Drafted:

> **Q-4** — Geometric accuracy: edge paths and label positions deviate by at most 0.5 px from a
> reference computation at every zoom level, for everything the viewport shows. Where the mesh
> budget or memory runs short, the edge mesh may be coarsened instead, and its edge paths then
> deviate further: every edge in the viewport is still drawn while memory lasts, and the system
> reports the edge mesh as coarsened through inspection.

ADRs for Q-4: none of the accepted ADRs (0001 to 0006) rests on Q-4 or names it, so the change
moves the basis of none. Of the proposed ones, ADR-0012 depends on it: its chords outside the
rectangle and past the budget conflict with Q-4 as it stands, and the specification wins
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 5), so until this change lands the
conflict is raised, not resolved. ADR-0009 and ADR-0013 cite Q-4 for geometry the engine tests
natively; neither draws a mesh, and neither changes. The tests that cite Q-4 today
(`crates/engine/src/geometry.rs`, `crates/engine/src/stroke.rs`) decide the accuracy along a
path; with the property test of docs/plan/revision-2026-10-21/16-a-querys-mesh-has-a-budget.md,
which asserts it inside the query's rectangle and asserts the coarsened report, they decide the
first sentence, and that property test with the ticket's browser test decides the second. The
glossary gains *Coarsened* and *Inspection* with the revision of ADR-0012.

## Acceptance criteria

- [ ] Given the draft, when the maintainer decides, then the change lands in a pull request of
      their own that names the ADRs it moves, or the draft is dropped with the reason.
- [ ] Given the change landed, when the tests that cite Q-7 and Q-4 are read, then each decides a
      part of its new text, and a part no test decides is listed as pending; the sentence on
      accepted graph data, and Q-4's sentence past the budget, stay pending until the tests of
      docs/plan/revision-2026-10-21/16-a-querys-mesh-has-a-budget.md land.

## Read first

- `docs/SPECIFICATION.md` (*Quality Goals*, *Threats & Forbidden Actions*); ADR-0010, ADR-0007,
  ADR-0009 (*Bridge*, the limits of a load), ADR-0012 (*The rectangle*, *Mesh budget*).
- `examples/metric-tree/e2e/malformed.spec.ts`, `crates/engine-wasm/src/properties.rs`.
- docs/plan/revision-2026-10-21/16-a-querys-mesh-has-a-budget.md, whose tests cite the new
  sentence.

## Blocked by

- None (can start immediately)

## Mode

with the human: a change to the specification is the maintainer's decision.
