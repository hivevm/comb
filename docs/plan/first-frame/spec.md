# Spec: The first frame of a large load

## Problem

A host application that loads a large graph waits longer for its first frame than it did before
every field of graph data crossed the bridge to be checked there. On the AMD EPYC 7763 runners
of the Benchmark workflow, a load of 50,010 nodes and edges reaches its first frame at a median of
480 ms, against 378 ms before and a baseline of 378.6 ms, so the comparison of that runner kind
fails past its margin of 25 %. The render and the GPU did no more work; the load did. A timing of
the load's CPU path without a GPU puts most of the difference in the conversion of every field
by serde-wasm-bindgen, of the order of 100 ns a field, and smaller parts in a second checked copy
of every field in the bridge crate, in the snapshot, and in how the store builds its maps.

## Solution

A host application's load reaches its first frame about as fast as before the full checks, with
every check still made: every value the bridge refuses today is refused, with the same kind, the
same names of list, node or edge, and field, and the same choice of which refusal a load names
first. Two small fixes within the decisions in force come first. Then a load hands its nodes and
edges to the engine as columns, each one string or one typed array, so that the crossing costs a
handful of copies whatever the size of the graph, while single edits, errors, selection, and the
query keep crossing as they do.

## Existing behaviour

- A load checks in two passes: first every field read as a typed field, missing or of another
  type, and every item that is no object, the first named; then the identifiers' lengths and
  budget, and each node's and edge's rules, titles, label texts, and backgrounds among them.
  Pinned by the bridge crate's tests of malformed data, its property test against an oracle, and
  the browser tests of malformed data through the public interface.
- `api` reads the host's graph data once into a snapshot, fills in an edge's colour, arrowhead,
  and sides, hands a string with a lone surrogate over as a value of another type, and the store
  keeps the snapshot once the bridge accepted it. Pinned by the browser tests of reading graph
  data once, of hostile values, and the type test that only a snapshot reaches the bridge.
- What must stay: every refusal, its kind, its names, and its order; every limit; the store's
  state after a load; the drawing of the first frame. The old suites pass against the new
  crossing, extended to it, and none is weakened.

## Goals served

- Q-2: the load's time to its first frame. Q-2's target of 1 s on the reference machine holds
  already; this work keeps the margin the Benchmark guards, and cites no Q-2 in a test, since the
  runners are not the reference machine.
- Q-7 and Q-3 bound it: malformed graph data stays refused with a typed error, and the bundle
  stays under its limit.

## User stories

1. As a host application developer, I want a graph of 50,000 nodes and edges to reach its first
   frame as fast as it did, so that my users do not wait for the checks.
2. As a host application developer, I want every malformed value refused exactly as before, so
   that my handling of each kind of refusal keeps working.
3. As the maintainer, I want the Benchmark of the 7763 to judge the first frame against its
   unchanged baseline and pass, so that the gate keeps its memory of what a load costs.
4. As the maintainer, I want the 9V74's baseline taken from a load that crosses as columns, so
   that it does not allow the slower load.

## Implementation decisions

- The two fixes within the decisions in force: the bridge crate checks each field where it reads
  it instead of in a second copy, a fallback worked only if the columns are rejected, since the
  columns replace that code; and the store builds its two maps from identifiers to slots in one
  loop each, while the snapshot sets an edge's label and dash where present instead of spreading
  them; a test for any surrogate before the search for a lone one measured no gain in V8.
- The columns are the decision of ADR-0033: strings in pieces of at most 2^28 code units with UTF-16
  boundaries, numbers as 64-bit floats, enumerations and presence as bytes, a title's and a label
  text's validity per item, and the first value refused by its type as its position.
- Nodes go first, as the tracer bullet through every layer, with every refusal of a node; edges
  follow, and with them the serde path of a load goes.
- The effect of each step is measured by a timing of the load's steps in headless Chromium
  without a GPU, against the state before the step in the same session, and at the end by the
  Benchmark workflow on `main`.

## Testing decisions

- The seams are the ones that pin the behaviour today: the bridge crate's tests and property
  test, the browser tests of malformed data through the public interface, the bridge's tests in
  TypeScript, and the type test of what reaches the bridge, which pins the generated parameters
  of a load.
- The order of the two passes gets a test of its own where none pins it: a coordinate that is not
  finite in an early node beside a title with a lone surrogate in a later one names the
  coordinate.

## Out of scope

- Columns for a single edit, a patch, the query, errors, or selection.
- Detecting lone surrogates in the bridge crate, and reading a side left out as its default in
  the bridge crate; both would move decisions of ADR-0028 and ADR-0024.
- Q-1 and Q-2 on the reference machine, which another ticket measures.

## ADR impact

- ADR-0033 decides the columns; the specification's constraint on the
  bridge excepts the graph data of a load from serde-wasm-bindgen.
- Binding beside it: ADR-0028 (validation in the bridge crate, what `api` decides), ADR-0024 (the
  sides and their defaults), ADR-0022 and ADR-0029 (the store's maps), ADR-0008 (the Benchmark),
  ADR-0007 (the protected parts every ticket here touches).
