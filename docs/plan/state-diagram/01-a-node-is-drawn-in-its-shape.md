# Ticket: A node is drawn and hit in its shape, and the state diagram of a Comb opens

## What to build

The tracer bullet. The host application gives a node a shape from the closed set, and Comb
draws it in that shape, hits it within its outline, and lays its content out in the shape's
inner rectangle, `heightOf` answering for it. The UML example's sidebar gains the state diagram
of a Comb's life:
- its states are rounded rectangles of their name;
- its initial state is a filled circle;
- its final state is a ringed circle;
- its choice is a diamond;
- its transitions are today's edges by sides, labelled by their event.

Viewing only. Graphs without shapes draw as before.

## Acceptance criteria

- [ ] Given a node of each shape, when the canvas draws it at the near level, then it draws the
  shape's outline in the node's colour and the content inside the inner rectangle, and
  `heightOf` gives the height it lays out to (G-13, G-10).
- [ ] Given a circle and a diamond, when the user clicks inside the node's rectangle but outside
  its outline, then nothing is selected; when the user clicks inside the outline, then the node
  is (G-13, G-5).
- [ ] Given an unknown shape in graph data, when it is loaded or added, then it is refused,
  naming the node and the field (Q-7).
- [ ] Given the UML example, when the user chooses the state diagram, then it shows a Comb's
  life with its states, initial and final state, and choice in their shapes (G-12).
- [ ] Given the metric tree, the class diagram, and the package diagram, when their browser
  tests and the benchmark's tests run, then they pass unchanged.

## Read first

- Touches: `crates/engine/`, `crates/engine-wasm/`, `packages/comb/src/`, `examples/uml/`,
  `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`, `docs/CONVENTIONS.md`
- The spec next to this ticket, and the proposed ADR on node shapes.
- Glossary: *Node content*, *Content element*, *Level of detail*, *Inspection*.
- Golden path: the content model's layout and its drawing (ADR-0013), `heightOf` (ADR-0026),
  and the UML example's package diagram for a diagram of its own.

## Blocked by

- None (can start immediately), once the ADR on node shapes is reviewed

## Mode

with the human: it touches protected parts (the public interface, the bridge, the data format)
and the look of each shape.
