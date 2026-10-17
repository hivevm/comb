# Ticket: Draw less the further the user zooms out

## What to build

Zooming out switches the scene through three levels of detail: near draws node boxes, titles, and
edge labels; middle draws node boxes and titles; far draws nodes as particles of one particle
container and edges as thin lines, without text. With 50,000 nodes zoomed out to the whole graph,
dragging, panning, and zooming stay within Q-1 on the reference machine.

## Acceptance criteria

- [ ] Given the example, when the user zooms through each threshold, then the scene switches
      level, and a browser test reads the level and the count of bound text objects at each.
- [ ] Given the example at 50,000 nodes zoomed to fit, when the count of bound display objects is
      read, then it stays under a bound independent of the graph's size, apart from the one
      particle container.
- [ ] Given `bun run bench` on the reference machine, when it runs at 50,000 nodes, then the p95
      frame time of drag, pan, and zoom is at most 16.7 ms and the time to first frame at most
      1 s, or the pull request says by how much they miss (`Verifies: Q-1`, `Verifies: Q-2` once
      they hold).
- [ ] Given the thresholds, when the ticket closes, then their values are the ones the benchmark
      chose, and the pull request says why.

## Read first

- ADR-0012 (levels of detail), Q-1 and Q-2 of the specification and the reference machine.
- The benchmark of ticket 01 and its baseline.

## Blocked by

- docs/plan/large-graphs/03-culling.md
- docs/plan/large-graphs/04-edge-mesh.md

## Mode

with the human: only the maintainer can measure on the reference machine, and the thresholds are
judged by eye as well as by number.
