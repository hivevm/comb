# Ticket: Measure a 50,000-node graph

## What to build

The tracer bullet: before anything is optimised, the maintainer can open the example with
50,000 nodes and 50,000 edges and run one command that reports how long the graph takes to show
and how long frames take while a node is dragged, the viewport panned, and zoomed. The numbers of
today's scene are the baseline every later ticket is measured against. Drag and selection, which
the later tickets change, are pinned by a browser test first.

## Acceptance criteria

- [ ] Given the example, when the user picks the largest copies option, then it shows a metric
      tree of at least 50,000 nodes and as many edges, and the count in the sidebar says so.
- [ ] Given the example opened with a copies query parameter, when it loads, then it shows that
      many copies without touching the control.
- [ ] Given the example with one tree, when a browser test drags a known node and clicks it, then
      the node's edges and edge labels follow, and the sidebar shows its title.
- [ ] Given the example at 50,000 nodes, when `bun run bench` runs, then it writes JSON with time
      to first frame and p95 frame time for drag, pan, and zoom, and prints them beside the
      targets of Q-1 and Q-2.
- [ ] Given the measured numbers of today's scene, when the ticket closes, then they are recorded
      in the pull request as the baseline.

## Read first

- ADR-0008 (benchmark, commands), ADR-0012 (the scene being measured), ADR-0011 (coordinates
  out of the store).
- `docs/ARCHITECTURE.md`: the test pattern and the drag path.
- Glossary: viewport, node, edge, edge label.
- The example's existing browser test, which the new ones copy.

## Blocked by

- None (can start immediately)

## Mode

with the human: the benchmark's numbers on the reference machine only the maintainer can take,
and the shape of the JSON is what the CI workflow of ticket 06 will rely on.
