# A connection adds one kind of relationship, and the sidebar switches it

- **Observed:** G-20 says a connection adds each relationship, flow, or transition. In the UML
  example, a connection between two use cases always adds an include, and one between two actions
  a control flow; an extend, a generalization between use cases, and an interrupting edge come only
  by switching the kind in the sidebar afterwards. The human kept that for tickets 13 and 16 of
  uml-diagrams on 2026-11-19 and 2026-11-20, and counted G-20 as met with it open after the
  whole-branch review.
- **Where:** `connectedOf` of the diagram descriptors in `examples/uml/src/`, the kind select of
  `examples/uml/src/sidebar.ts`, and the connect gesture of `packages/comb/src/interaction/`.
