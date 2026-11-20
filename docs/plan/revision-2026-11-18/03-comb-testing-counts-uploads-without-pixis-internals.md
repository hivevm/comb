# Ticket: comb/testing counts the mesh's uploads without a method internal to PixiJS, or an ADR says it may

## What to build

`countCalls` of `packages/comb/src/testing.ts` counts the mesh's uploads by wrapping
`renderer.buffer._upload`, a method internal to PixiJS. It broke twice in a month:

- dc803c3b (2026-11-03): `gpuEdgeIndices` read an index buffer PixiJS no longer made as before;
- 12ffb82f (2026-11-17): with PixiJS 8.23 the wrapped `updateBuffer` was bypassed, the mesh's
  uploads counted 0, and two browser tests went red on a Dependabot bump.

It now throws where the method is missing rather than count nothing, so the next change of PixiJS's
internals fails loudly, but it fails again. No ADR decides whether a testing seam of `comb/testing`
may reach into the renderer's internals, or how a bump of PixiJS is kept from breaking it.

Decide with the maintainer, and build what is decided:

- count the uploads from what Comb itself hands PixiJS (its buffers and their `update` calls),
  which needs nothing internal; or
- keep the wrapper, and propose through `propose-adr` that a testing seam may reach a renderer's
  internals, with what holds a bump: the PixiJS version pinned to a minor, or a test of the seam
  against each version Dependabot proposes.

## Acceptance criteria

- [ ] Given the decision, when it binds future seams, then a `proposed` ADR records it, or the
      ticket's hand-off says why none is due.
- [ ] Given the browser tests that read `meshBytesUploaded`, when they run on the PixiJS the
      lockfile names, then they pass.
- [ ] Given a PixiJS whose buffer system lacks the method counted today, when the counting runs,
      then it counts the mesh's uploads, or the decision's test fails naming the method.

## Read first

- Touches: `packages/comb/src/testing.ts`, `package.json`, `packages/comb/package.json`
- REN-virtualized-scene-graph, DEV-bun-vite-wasm-pack; the **Test pattern** part of
  `docs/ARCHITECTURE.md`.
- The messages of dc803c3b and 12ffb82f.

## Blocked by

- None (can start immediately)

## Mode

with the human: whether a seam may reach a renderer's internals is a decision that binds future
seams, and the maintainer takes it.
