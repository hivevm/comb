# Ticket: A patch field is refused by the name the host application wrote

## What to build

`patchOf` (`api/snapshot.ts`) hands the first field of a patch other than `title` to the bridge
under its name read as a text: `plain[read.text(key) as string] = false`. For a key within the
text limit that holds a lone surrogate, `read.text` returns `false`, so the field crosses as
`"false"`, and the bridge refuses it as `unknownPatchField` naming the field `false`, which is
not what the host application wrote. Q-7 asks the typed error to name what it refused. The
fault was found by reading; no test runs it.

The key is a name, not a text the store keeps: it needs the cut of a text (so that a key of any
length costs no more to check) but not the lone-surrogate refusal. Hand it over cut and
otherwise as written; the bridge crate receives a lone surrogate as U+FFFD (ADR-0009, *What the
bridge cannot see*), so the problem names the key with U+FFFD in its place, which is what a
Rust `String` can carry. Naming it exactly as written would need `api` to build this refusal
itself, a third item of that ADR clause; that is not this ticket.

In the same change, the doc comment of `NodePatch` in `crates/engine-wasm/src/lib.rs` says `api`
hands over `false` in place of a patch that is no plain object; `api` throws an unreadable error
instead, which comes back as malformed. Correct it to what `patchOf` does.

## Acceptance criteria

- [ ] Given `updateNode("a", { "x\uDC00": 1 })`, when it is refused, then the `GraphDataError`
      is `unknownPatchField` and its `field` is `"x\uFFFD"`, not `"false"`
      (`Verifies: Q-7, ADR-0009`).
- [ ] Given the browser test of `updateNode` naming a node the graph does not hold
      (`malformed.spec.ts`), when it is read, then it cites `Verifies: ADR-0009` beside Q-7, as
      the Enforcement of ADR-0009 names it.
- [ ] Given a key longer than the text limit, when it is refused, then the field is the key cut
      as today (the `hugeKey` case of `malformed.spec.ts` unchanged).
- [ ] Given the bridge crate, when its `NodePatch` comment is read, then it says what `api` hands
      over.
- [ ] Broken once: with the old line back, the first criterion's test fails naming `"false"`.

## Read first

- ADR-0009 (*What the bridge cannot see*); `docs/SPECIFICATION.md` Q-7.
- `packages/comb/src/api/snapshot.ts` (`cut`, `readerOf`, `patchOf`);
  `examples/metric-tree/e2e/malformed.spec.ts` (the patch cases, `hugeKey`).

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches `packages/comb/src/api/` and `crates/engine-wasm/`, protected parts
of ADR-0007.
