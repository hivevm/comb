# Ticket: The class diagram of Comb opens from VS Code

## What to build

It starts once the maintainer has reviewed ADR-draft-one-workspace-per-example and landed G-12
in the specification.

The tracer bullet through new ground. The developer starts *Example: UML* in VS Code (or
`bun run example:uml`); the engine builds, a second example host application is served, and the
browser shows the class diagram of Comb's public interface: `Comb`, `CombOptions`, `GraphData`,
`NodeData`, `EdgeData`, `EdgeLabelData`, `NodeContent`, `Selection`, `Viewport`, `GraphChange`,
and the error classes, each with its stereotype, name, attributes, and operations as rows, and
the relationships between them as edges told by kind. The sidebar shows the legend of the kinds
and the choice of diagram, with the class diagram the one choice so far. Viewing only: no palette,
no edits yet.

Along the way the second example takes its place in the repository: its workspace, its build in
`bun run build`, its browser tests in `bun run test` (a Playwright setup of its own beside the
metric tree's), its launch configuration, the structural check's case that no example imports
another (with its self-test), the structure overview and the glossary, and, once the maintainer
has accepted the ADR, every `Verifies: ADR-0009` marker moved to its number.

## Acceptance criteria

- [ ] Given the Dev Container, when the developer starts *Example: UML*, then the engine builds,
  the UML example is served, and the host's browser opens it, the metric tree's launch
  configuration unchanged (G-12).
- [ ] Given the UML example loaded, when its first frame is drawn, then every class and
  interface of the diagram is a node whose content holds a caption for its stereotype where it
  has one, a title for its name, and one body text per attribute and per operation, and
  `heightOf` placed it (G-12, G-10).
- [ ] Given the class diagram, when its edges are drawn, then each relationship kind has the
  colour, dash pattern, arrowhead, and label the conventions record for it, and the legend in the
  sidebar names each (G-12, G-11).
- [ ] Given a file under `examples/uml/` that imports a file of `examples/metric-tree/`, when the
  structural check runs, then it fails naming the file; its self-test covers the case.
- [ ] Given both examples, when `scripts/check-all.sh` runs, then it builds and tests both, and
  the metric tree's browser tests and the benchmark's tests pass unchanged.

## Read first

- Touches: `examples/uml/`, `package.json`, `playwright.config.ts`, `.vscode/launch.json`,
  `scripts/check-structure.sh`, `scripts/test-check-structure.sh`, `docs/ARCHITECTURE.md`,
  `docs/GLOSSARY.md`, `docs/CONVENTIONS.md`, `README.md` (its **Build, Test & Run** section)
- The spec next to this ticket, and ADR-draft-one-workspace-per-example (or its number once on
  `main`).
- Glossary: *Host application*, *Node content*, *Content element*, *Sidebar*, *Arrowhead*,
  *Dash pattern*, *Edge label*, *Side*.
- Golden path: `examples/metric-tree/` (`src/main.ts` for creating Comb and the window hooks,
  `src/graph.ts` for content and placing by `heightOf`), and
  `examples/metric-tree/e2e/example.spec.ts` for the seam of the browser tests.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches protected parts (`scripts/check-*.sh`, `scripts/test-check-*.sh`,
ADR-0007), and the visual mapping of the relationship kinds is the maintainer's to settle.
