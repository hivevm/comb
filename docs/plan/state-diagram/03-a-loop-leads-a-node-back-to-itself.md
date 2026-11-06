# Ticket: A loop leads a node back to itself, where the host application allows loops

## What to build

An option of Comb allows loops. Where it is on:
- `addEdge` accepts an edge from a node back to itself;
- the user's connection counts the source's own connectors and outline as compatible.

A loop is drawn as a cubic that leaves and re-enters one side of the node, the top by default,
with its label at the loop's outermost point. Where the option is off, both refuse a loop as
today. A loop in a load is drawn as a loop in either case. The state diagram allows loops and
shows one on *ready*.

## Acceptance criteria

- [ ] Given loops allowed, when the host adds an edge from a node to itself, then a loop is drawn
  above the node with its arrowhead into the node, and its label at the loop's top (G-13).
- [ ] Given loops allowed, when the user drags a connection from a node back onto it, then the
  veto is asked and a loop is added where it allows one (G-13, G-3).
- [ ] Given loops not allowed, when the host adds a loop or the user drags back onto the source,
  then it is refused as today (`selfEdge`) and no edge is added.
- [ ] Given a loop on a node far from the origin, when its path is computed, then every point is
  one `f32` holds (ADR-0030's world).

## Read first

- Touches: `crates/engine/`, `crates/engine-wasm/`, `packages/comb/src/`, `examples/uml/`
- The spec, and the proposed ADR on docking on the outline (which decides loops).
- Glossary: *Connection*, *Veto*, *Edge label*, *Path parameter*.
- Golden path: the connect gesture and its tests (`examples/metric-tree/e2e/connect.spec.ts`).

## Blocked by

- docs/plan/state-diagram/02-an-edge-docks-on-the-outline.md

## Mode

with the human: it touches protected parts (the public interface, the gesture) and changes a
refusal callers rely on.
