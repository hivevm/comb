# The UML example's rules cannot refuse an edge by where its ends lie

- **Observed:** the UML example refuses a connection by the kinds of its two ends alone. UML
  2.5.1 also ties some edges to where their ends lie: an interrupting edge leaves its
  interruptible region, its source inside and its target outside, and an exception handler's
  input pin belongs to the handler body, not to the protected action or to an unrelated one. The
  activity diagram's kind select offers an interrupting edge between any two nodes the table
  allows, and an exception handler from any action to any input pin. The review of ticket 16 of
  uml-diagrams found this on 2026-11-20; G-20 asks only for a table of the pairs a diagram
  refuses.
- **Where:** `refusal` and the activity table of `examples/uml/src/rules.ts`, which read two kinds,
  and the example's copy of the graph in `examples/uml/src/diagram.ts`, which knows where each
  node lies.
