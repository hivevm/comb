# Ticket: heightOf and addNode check a node through one function

## What to build

`heightOf` promises the host application the problems `addNode` gives the same content and width
([ADR-0035](../../adr/0035-the-host-asks-the-height-content-lays-out-to.md)). In the bridge
crate the two hold that promise by writing the same sequence twice:
`add_node_to` and `height_of` of `crates/engine-wasm/src/graph_data/load.rs` each call
`node_of`, `checked_node`, `checked_content`, and `within_by_height` in that order, `add_node_to`
with the graph's size and the identifier's length checked first. A check added to one later, or a
change of their order, which decides the problem a node with two faults gives, reaches the other
only if its author sees the copy; the tests of `heightOf` compare a handful of refusals, not every
one.

One function checks the node a single crossing hands over, and returns what both need, its place,
its width, its checked content, and its height; `add_node_to` adds to the graph what it returns,
after the checks that only an addition makes, and `height_of` returns the height alone. The
refusals and their order stay as they are.

## Acceptance criteria

- [ ] Given `crates/engine-wasm/src/graph_data/load.rs`, when it is read, then `node_of`,
      `checked_node`, `checked_content`, and `within_by_height` are each called once, in the one
      function both crossings reach.
- [ ] Given the tests of `heightOf` in `crates/engine-wasm/src/graph_data/load.rs` and
      `examples/metric-tree/e2e/height-of.spec.ts`, when they run, then they pass unchanged.
- [ ] Broken once: with `within_by_height` left out of the shared function, a test of the bridge
      crate that adds a node and one that asks its height both fail.

## Read first

- ADR-0035, ADR-0028 (the bridge as the one place that checks graph data), ADR-0034.
- `crates/engine-wasm/src/graph_data/load.rs`, `crates/engine-wasm/src/graph_data/checks.rs`.

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine-wasm/` is a protected part of
[ADR-0007](../../adr/0007-harness.md), the validation of graph data that holds Q-5 to Q-7.
