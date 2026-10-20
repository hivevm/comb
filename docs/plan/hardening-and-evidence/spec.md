# Spec: Hardening and evidence

## Problem

A host application that embeds Comb relies on its security goals without being able to check
them. Comb says it never interprets graph data as markup (Q-5), never requests anything of its
own and runs under a strict Content Security Policy (Q-6), and rejects malformed graph data with a
typed error (Q-7). Today it loads its engine with a request of its own, accepts two edges with one
identifier, and ignores a change to a node that does not exist. No test cites Q-5, Q-6, or Q-7.
Dragging a node (G-2) and panning and zooming (G-8) work, but no test drives them through the
pointer and cites them, so a regression there goes unnoticed.

## Solution

A host application hands Comb the engine itself and can serve its page under
`script-src 'self' 'wasm-unsafe-eval'` with no `connect-src` opened for Comb. Malformed graph data
of every kind the specification names is refused with a typed error, through the public
interface, without a panic or a hang. Hostile text in titles and labels stays text. Every one of
these properties, and G-2 and G-8, is cited by a test that fails when it breaks.

## Existing behaviour

- `createComb` takes optional `CombOptions` and loads the engine through the wasm-bindgen
  initialiser without an argument; the library build inlines the engine as a `data:` URL. This
  changes: the host hands the engine over (ADR-0019), a breaking change for every caller, the
  example and the benchmark among them.
- The bridge crate rejects non-finite coordinates and sizes, a duplicate node identifier, an edge
  to a missing node, and malformed colours, dash patterns, and labels; its tests and the bridge's
  malformed-data test pin that and must stay.
- Titles and labels are drawn with PixiJS text and no value of the graph data reaches the DOM.
  Nothing pins it.
- Drag, pan, and zoom are tested below the canvas (interaction and viewport tests) and in the
  browser through `setViewport`; those tests stay.

## Goals served

- Q-5, Q-6, Q-7 — closed and cited.
- G-2, G-8 — cited by browser tests through the pointer.

## User stories

1. As a host developer, I want to hand Comb its engine myself, so that my page's policy and my
   bundler, not Comb, decide how the file arrives.
2. As a host developer, I want `createComb` to refuse a missing or fetchable engine option with a
   typed error, so that a mistake shows at once and not as a request my policy blocks.
3. As a host developer, I want Comb to run under `script-src 'self' 'wasm-unsafe-eval'`, so that I
   need not weaken my Content Security Policy for it.
4. As a host developer, I want graph data with two edges of one identifier rejected, so that a
   bug in my data shows as an error and not as an edge that cannot be addressed.
5. As a host developer, I want a change to a node that does not exist rejected with a typed
   error, so that my sidebar does not edit nothing in silence.
6. As a host developer, I want arbitrary malformed graph data to come back as a typed error and
   never as a panic or a hung page, so that my users' data cannot take my page down.
7. As a host developer, I want a title or label like `<img src=x onerror=…>` drawn as those
   characters, so that graph data from my users cannot run script in my page.
8. As a maintainer, I want lint rules that forbid `eval`, `new Function`, and DOM markup sinks in
   Comb's sources, so that Q-5 and Q-6 hold for code not yet written.
9. As a user, I want a node to follow my pointer and its edges to follow the node, and the canvas
   to pan and zoom about my pointer, so that the editor feels direct; as a maintainer, I want a
   browser test to say so.

## Implementation decisions

- The engine option, its forms, its refusal, the package export of the engine file, and the
  library build without inlining follow ADR-0019.
- A duplicate edge identifier is refused by the bridge crate like a duplicate node identifier,
  naming the edge.
- `updateNode` with an identifier the graph does not hold throws the graph-data error that names
  the identifier; the store keeps the graph unchanged.
- Malformed data is generated, not only written by hand: a property test feeds the bridge crate's
  validation random graph data with non-finite numbers, missing ends, duplicates, and wrong types,
  and asserts a typed error or a valid graph, never a panic.
- ESLint forbids `eval`, implied eval, `new Function`, and the DOM markup sinks (`innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `createContextualFragment`)
  in Comb's library sources.
- The browser tests serve the example under a Content Security Policy in test mode, so the
  policy is part of the environment of every browser test, not of one.

## Testing decisions

- The public interface is the seam: `createComb`, `load`, and `updateNode` in Bun tests with the
  bridge created from the engine's bytes, as the bridge's tests do today.
- The bridge crate's validation is tested in Rust, as its malformed-data tests are today; the
  property test runs there.
- The browser tests copy the example's existing tests: Playwright drives the pointer with
  `page.mouse` and reads positions through `comb/testing`'s `screenPoint` and `inspect()`.
- Each ticket breaks its feature once and says how the test failed.

## Out of scope

- Editing: adding, connecting, and deleting nodes and edges, edge selection, `updateEdge`, and
  dragging labels (G-1, G-3 to G-6) — a spec of their own.
- Node content (G-10) and what G-9 still lacks.
- Q-1 and Q-2 on the reference machine — ticket 16 of the design revision of 2026-10-18.

## ADR impact

- Binding: ADR-0009 (structure), ADR-0010 (bridge and the validation of graph data), ADR-0011
  (store), ADR-0008 (toolchain, lint), ADR-0018 (`createComb` and `CombOptions`).
- New: ADR-0019, proposed, decides how the engine reaches Comb; ticket 03 implements it after the
  maintainer's review.
- ADR-0007 keeps the public interface, the validation of graph data, and the CI workflows with the
  maintainer; the tickets that touch them are worked with the human.
