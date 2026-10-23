# Ticket: A segment that crosses the viewport keeps Q-4 when its ends lie far outside it

## What to build

The engine hands over the edge mesh relative to an origin near the query's rectangle (ADR-0010),
so a vertex rounds by its distance from the rectangle. A segment of the flattened path that
crosses the rectangle may still have its ends far outside it: a straight edge is flat at once and
is one segment however long, and a long curve flattens into long segments where it is nearly
straight. An end at a distance `d` from the origin strays by up to `d` × 2^-24 world units, and
the line between the ends strays with it inside the viewport: 0.5 px at a scale `s` from
`d` = 2^23 / `s`, about 2.1e6 at a scale of 4, while the query reports the mesh complete. Q-4 asks
for 0.5 px for everything the viewport shows. One way: split a segment where it leaves the
query's rectangle grown by the stroke's width, so that no vertex of a segment that meets the
rectangle lies farther from it than the grown rectangle reaches; another is to clip it there.
Either changes how the stroke is flattened (ADR-0012, *The rectangle*), and the dash pattern's
distance along the path has to stay continuous across the split.

## Acceptance criteria

- [ ] Given a straight edge from (-1e7, -3e6) to (1e7, 3e6) and a viewport on its middle at a
      scale of 4, when it is drawn, then every point of the edge inside the viewport lies within a
      quarter pixel of the stroke the shell draws (`Verifies: Q-4`).
- [ ] Given the benchmark's graph, when its first frame and gestures are measured, then Q-1 and
      Q-2 hold as before.
- [ ] Broken once: without the split, the first criterion's test fails.

## Read first

- `docs/SPECIFICATION.md` Q-4; ADR-0010 (*Origin*, *Consequences*), ADR-0012 (*The rectangle*,
  *Mesh budget*).
- `crates/engine/src/stroke.rs` (`subdivide`, `polyline`),
  `examples/metric-tree/e2e/far-from-the-origin.spec.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine/src/stroke.rs`, which holds the mesh budget, is a protected part of
ADR-0007.
