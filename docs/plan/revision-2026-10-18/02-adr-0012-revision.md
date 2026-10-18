# Ticket: Revise ADR-0012 to the scene that was built

## What to build

A revision of the proposed ADR-0012, in a pull request of ADRs only, developed with the
maintainer through `propose-adr`. Four of its clauses no longer say what the code does:

- **Thresholds.** The Decision says the zoom thresholds are "set by the benchmark".
  `NEAR_SCALE = 0.6` and `FAR_SCALE = 0.3` (`packages/comb/src/render/scene.ts`) were chosen by
  when titles and labels stop being legible; on SwiftShader the three levels measure alike, so the
  benchmark could not choose them. The decision to take: thresholds by legibility, checked by the
  benchmark on the reference machine, or by the benchmark once it can tell the levels apart.
- **Layers.** The Decision lists `grid`, `edges`, `nodes`, `labels`, `connectors`. The world holds
  `EdgesContainer`, `NodeParticles`, `NodesContainer`, `LabelsContainer`: the particle layer of the
  far level is not in the list, and `grid` and `connectors` do not exist yet. The decision to take:
  where the particle layer sits in the drawing order, and whether the list names only what exists.
- **Edges.** The Decision has the engine compute path points and `edges` draw dashes "in its
  geometry or shader". The engine triangulates the whole mesh (positions, distances along the
  edge, colours, dash patterns, indices) and the shader only leaves out the gaps. Record which
  side owns the stroke, since the next spec (*Editing*, G-11) adds appearance to it.

- **Culling.** The Decision has `render` ask the engine for the visible slots "after every change
  of the viewport or of coordinates". The scene moves the world alone, without a query, while the
  viewport stays inside the rectangle it last queried and the scale within a factor of 1.25 of
  the one it queried at (`covers` and `RESCALE` in `scene.ts`), which is what makes a pan cheap.
  Record the rule and its bound, which
  docs/plan/revision-2026-10-18/01-g7-culling-margin-spec-change.md
  carries into G-7.

The ADR's follow-ups "the zoom thresholds" and "the margin around the viewport" are settled by the
code and close in the revision.

## Acceptance criteria

- [ ] Given the revised ADR-0012, when it is read beside `render/` and
      `crates/engine/src/stroke.rs`,
      then each clause above says what the code does, or a ticket exists to change the code.
- [ ] Given the revision, when it lands, then its pull request holds ADRs only.

## Read first

- ADR-0012 in full, ADR-0010 (the streams), the `propose-adr` skill.
- `packages/comb/src/render/scene.ts` (levels, layers), `crates/engine/src/stroke.rs`.

## Blocked by

- None (can start immediately)

## Mode

with the human: an ADR is developed with the maintainer, who alone decides it
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules)).
