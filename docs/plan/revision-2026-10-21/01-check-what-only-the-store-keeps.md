# Ticket: Refuse malformed graph data the engine never sees

## What to build

The bridge crate checks every field of graph data that crosses into the engine. Titles, label
texts, and label backgrounds never cross: `load` hands them to the store unchecked, and
`updateNode` merges its patch into the store with a spread, whatever its keys and values. PixiJS
throws on a colour it cannot convert (`Unable to convert color`, checked against PixiJS 8.22.0
for `-5`, `NaN`, `1e20`, and `{}`), so a label background like `-5` passes `load` and then
throws in the render that first binds the label, inside the animation frame, where the host
application cannot catch it; `NaN`, which never equals what the view last drew, throws in every
render. A title that is not a string reaches `BitmapText` unchecked too. A
patch such as `{ id: "b" }` or `{ width: -1 }` changes the store's node while the engine and the
store's map of slots keep the old values. Q-7 says malformed graph data never crashes the page and
is refused with a typed error; these are refused by nothing.

Every field of graph data is checked once, where it enters, and refused with a `GraphDataError`
that names the node or edge and the field. Where the check lives, in the API or in the bridge
crate with the field sent across, is the maintainer's decision. ADR-0009 names `api` as holding
"the validation of graph data", while the bridge crate holds all of it today. The decision is
recorded as a revision of ADR-0009, in a pull request of ADRs only, before the code.

## Acceptance criteria

- [ ] Given graph data whose title, label text, or label background has the wrong type or a
      value PixiJS cannot draw (a background beyond `0xFFFFFF` or negative), when the host loads
      it, then `load` throws a `GraphDataError` naming the node or edge and the field, and the
      previous graph stays drawn (`Verifies: Q-7`).
- [ ] Given a loaded graph, when the host calls `updateNode` with a patch holding a key other than
      `title` or a title that is not a string, then it throws a `GraphDataError`, the store's
      nodes stay the same array, and no render is scheduled.
- [ ] Given random graph data, those fields included, when it is loaded through the public
      interface, then each case ends in a typed error or a drawn graph, and no page error occurs.
- [ ] Broken once: without the check of the label background, the first criterion's browser test
      fails with the page error PixiJS throws.

## Read first

- `docs/SPECIFICATION.md` Q-7; ADR-0009 (*Shell*), ADR-0010 (*Errors*), ADR-0011, ADR-0007
  (protected parts).
- `packages/comb/src/api/index.ts` (`batchOf`, `updaterOf`), `packages/comb/src/store/index.ts`,
  `packages/comb/src/render/labels.ts`, `packages/comb/src/render/nodes.ts`.
- `examples/metric-tree/e2e/malformed.spec.ts`, the golden path of the test.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the validation of graph data and the contract of `updateNode`, both
protected parts of ADR-0007, and it starts with the maintainer's decision on where the check
lives.
