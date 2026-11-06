# Architecture Decision Records

This directory contains all Architecture Decision Records (ADRs) for this project. Accepted ADRs are
**binding** for humans and coding agents alike (see [`AGENTS.md`](../../AGENTS.md) in the repository
root). ADRs derive from the specification in [`docs/SPECIFICATION.md`](../SPECIFICATION.md).

## Mechanics

The rules live in [`AGENTS.md` §3](../../AGENTS.md#3-adr-rules): when an ADR is written, how it
is developed, who flips its status, that an accepted one is immutable and changed only by
supersession. This section carries only the mechanics of the record;
[`scripts/check-docs.sh`](../../scripts/check-docs.sh) names in its header which of them it
verifies.

- **File.** Copy [`template.md`](template.md) to `draft-<slug>.md`, the slug in lower case letters
  and digits joined by hyphens. Until it reaches `main` the ADR is a draft: its heading and every
  reference name it `ADR-draft-<slug>`, its index row links it as `draft-<slug>`, and no number
  is taken ([ADR-0002](0002-decisions-verified-by-tests.md)). On the branch whose pull request
  brings it to `main`, once that branch has taken up the current `main`,
  [`scripts/number-adrs.sh`](../../scripts/number-adrs.sh) gives it the next free number. A
  numbered ADR is `NNNN-short-title.md`, its `# ADR-NNNN` heading matches the filename, and the
  numbers run `0001..N` without gaps.
- **Index.** The tables below change in the same commit as the ADR they describe, for
  additions, supersessions, and status flips alike. The status is shown via the legend's bullet
  and the ADR's `Applies to` header is mirrored verbatim in its own column. The index routes a
  reader from a change to the decisions that bind it, so a row says what its ADR governs without
  the file being opened. Two tables keep what a session reads apart from what it looks up: an
  accepted or proposed ADR sits under **Binding**, a superseded or rejected one under
  **Superseded and rejected**, and a status flip moves the row.
- **Numbers are permanent once on `main`, until a normalization.** Between two normalizations,
  never renumber, delete, or merge an ADR there: other ADRs, commits (`Implements ADR-NNNN`), and
  code may reference a number. No draft reaches `main`. A branch that already carries a numbered
  proposed ADR whose number another branch brought to `main` first gives it the next free number
  before it merges, in every reference its own branch makes to it. Until a normalization, a
  superseded ADR keeps its file and its body. The superseding ADR's `Supersedes` field names it
  from the proposal on; its `Status` line stays as it is while the successor is proposed, and
  flips to `⚪ superseded by ADR-NNNN` in the change where a human accepts the successor
  ([`AGENTS.md` §3](../../AGENTS.md#3-adr-rules), rule 4), its index row moving with it.
- **Between normalizations, sprawl is curbed by supersession, never by editing.** One ADR may
  supersede several whose decisions have grown into one. Its `Supersedes` field names each, and
  each flips its status when the superseding ADR is accepted, so the set an agent reads shrinks
  while every number and every body stays.
- **A normalization restates the record** ([`AGENTS.md` §3](../../AGENTS.md#3-adr-rules), rule
  5).
  - **Start.** The tree has no proposed ADR, no feature spec or ticket under `docs/plan/`, and
    green checks.
  - **Steps.** Three, in this order on one branch, each handed to the human and confirmed
    before the next begins: the restated specification, whose `G-n` and `Q-n` run from 1; the
    supersessions it calls for; and the restated record. The record begins once the human has
    decided each supersession. One pull request lands them, merged by a human.
  - **Order.** The record numbers the ADRs in force `0001..N` by what they govern. The document
    set and the ADR process come first, then the founding decisions in the order of the setup,
    then the rest in groups. An inherited ADR takes its place like any other, and may be merged
    with the project's own.
  - **Clauses.** Every clause of an old ADR lives on in one new ADR. The hand-off of the
    record lists each clause with the new ADR that carries it.
  - **Header.** A new ADR keeps the status of the ADRs it restates. Its `Deciders` name all of
    theirs, its `Date` is the latest of theirs, and it has no `Supersedes` field. In an
    adoption, an ADR the project had accepted stays accepted. A decision found outside any
    record enters as proposed.
  - **Dead ADRs.** Superseded and rejected ADRs are deleted. What one of them chose, and why it
    did not stand, becomes an entry under *Alternatives considered* in the new ADR that governs
    its topic.
  - **References.** Each step moves its references with a map, old to new, applied by the map
    script of the `normalize` skill. The map stands in the hand-off and the
    commit body, and in no document. A commit older than the normalization cites the numbers it
    had then.
- **Cite only what exists.** Every `ADR-NNNN` reference names a file already in this directory.
  An anticipated follow-up is described by topic ("a follow-up ADR on session storage"), never by
  a number. In Markdown, cite an ADR as a link to its own file.

## Index

An ADR whose `Deciders` line names the **NUC maintainer** is inherited from the template. It
binds a derived project once its own maintainer adds their name to `Deciders` and its `Status`
line reads `🟢 accepted` ([`AGENTS.md` §3](../../AGENTS.md#3-adr-rules)). Change an inherited
decision by superseding it, never by editing. Once the template setup is done, check 12 of
[`scripts/check-docs.sh`](../../scripts/check-docs.sh) fails on an inherited ADR in force that
names no decider of the project, or that is still proposed.

**Status legend:** 🟢 accepted · 🟡 proposed · 🔴 rejected · ⚪ superseded

### Binding

The decisions in force: accepted, and proposed ones that bind the work implementing them. This
is the table a session reads.

| ADR | Title | Applies to | Status |
|-----|-------|------------|--------|
| [0001](0001-agent-governance-model.md) | The document set: one specification, one ADR record, one `AGENTS.md`, one overview, one glossary, one conventions file | every document that carries rules for humans or agents, `AGENTS.md` among them, the architecture overview, the glossary, the conventions, `scripts/check-docs.sh`, `scripts/sensor-binding-adrs.sh`, and the map script of the `normalize` skill, `.agents/skills/normalize/remap.sh` | 🟢 accepted |
| [0002](0002-decisions-verified-by-tests.md) | Every accepted decision and every success criterion is verified by a test that cites it, and the checks that hold the decisions are bash scripts under `scripts/` | every accepted ADR, the identifiers by which ADRs are cited, the Goals and Quality Goals of `docs/SPECIFICATION.md`, the tests that verify them, the checks and sensors under `scripts/`, and the git hooks under `.githooks/` | 🟢 accepted |
| [0003](0003-procedures-as-skills.md) | The procedures of the rule file are Agent Skills under `.agents/skills/`, each carrying a how and no rule of its own | `.agents/skills/`, the pointers under `.claude/skills/`, and every document that describes how a procedure of `AGENTS.md` is carried out | 🟢 accepted |
| [0004](0004-dev-container-runtime.md) | The Dev Container keeps the host daemon out of reach, its Features locked, and each project under a path of its own | `.devcontainer/`, `.vscode/settings.json`, `scripts/check-devcontainer.sh`, and everything the container pulls in | 🟢 accepted |
| [0005](0005-template-releases.md) | The template is released as SemVer tags on `main`, and every repository names the release it carries | the tags of the template repository, its own ADRs, the **Template** section of `README.md`, check 14 of `scripts/check-docs.sh`, and the pull request that lands a release | 🟢 accepted |
| [0006](0006-feature-layer.md) | Work larger than one session is planned in the tree as a feature spec cut into tracer-bullet tickets, files deleted when their work lands, and the design is revised when a spec closes or after a number of changes | every change larger than one agent session, `docs/plan/`, the spec and ticket templates of the `plan-feature` skill, the pull request template, the `Last design revision` line of `docs/ARCHITECTURE.md`, `scripts/sensor-revision-due.sh`, `scripts/sensor-plan-frontier.sh`, and the claim script `.agents/skills/work-tickets/claim.sh` | 🟢 accepted |
| [0007](0007-harness.md) | One agent implements, a fresh session reviews, and the protected parts stay with the maintainer | every change and every agent session in this repository, `docs/adr/`, `docs/SPECIFICATION.md`, `.github/CODEOWNERS`, and the tickets under `docs/plan/` | 🟢 accepted |
| [0008](0008-toolchain.md) | TypeScript with Bun, Vite, Playwright, ESLint, and Prettier; Rust with wasm-pack, cargo test, clippy, and rustfmt | `package.json`, `bun.lock`, `Cargo.toml`, the lint and formatter configurations, `scripts/check-code.sh`, `scripts/check-all.sh`, `scripts/check-dependencies.sh`, `scripts/check-mutants.sh`, `crates/engine/mutants-missed.txt`, `bench/`, `playwright.config.ts`, `.github/workflows/`, and the **Build, Test & Run** section of `README.md` | 🟢 accepted |
| [0010](0010-bridge-data-format.md) | Structured data crosses the bridge through serde-wasm-bindgen with generated types, a load's graph data and node content as columns whose strings cross in pieces, coordinate streams through typed-array views on engine-owned buffers | `crates/engine-wasm/`, `packages/comb/src/bridge/`, the snapshot of a load in `packages/comb/src/api/snapshot.ts`, and every value that crosses between them | 🟢 accepted |
| [0011](0011-store.md) | The graph's structure and what the pointer is over live in a vanilla Zustand store; no coordinate does, and each kind of move is signalled by a counter of its own, an added node by its slot | `packages/comb/src/store/`, the state `packages/comb/src/interaction/` keeps between pointer events, and every module that reads or writes the state of the graph or the viewport | 🟢 accepted |
| [0012](0012-virtualized-scene-graph.md) | A virtualized scene graph with culling by the engine and three levels of detail, nodes bound by rank | `packages/comb/src/render/`, and the exports of `crates/engine` and `crates/engine-wasm` that answer spatial queries and compute edge geometry | 🟢 accepted |
| [0013](0013-node-content-model.md) | Node content is a closed set of elements in rows, laid out by the engine | the node-content types of `crates/engine` and `crates/engine-wasm`, their generated TypeScript definitions in `packages/comb`, the layout functions of the engine, the drawing of node content in `packages/comb/src/render/`, the report of a click on a content element in `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs` and its export in `crates/engine-wasm/`, the label extents the render layer of `packages/comb/src/render/` hands the engine, and the press and hover of `packages/comb/src/interaction/` | 🟢 accepted |
| [0014](0014-dev-container-toolchain.md) | The Dev Container builds from a Dockerfile that adds Bun, and takes Rust as a locked Feature | `.devcontainer/`, `.vscode/launch.json`, `.vscode/extensions.json`, the CI job that sets up the toolchain, `scripts/check-container.sh`, `scripts/test-check-container.sh`, and `.github/workflows/devcontainer.yml` | 🟢 accepted |
| [0015](0015-no-container-access.md) | The work inside the Dev Container reaches no container engine | `.devcontainer/`, every test that would need a service or a container, `scripts/check-container.sh`, `scripts/test-check-container.sh`, and `.github/workflows/devcontainer.yml` | 🟢 accepted |
| [0016](0016-no-secrets.md) | The repository holds no secrets and relies on GitHub's baseline | the repository, its CI workflows, and the repository settings | 🟢 accepted |
| [0017](0017-actions-pinned-by-sha.md) | Workflows reference actions by full commit SHA, kept current by Dependabot | every `uses:` line under `.github/workflows/`, `.github/dependabot.yml`, `scripts/check-all.sh`, and the `sensors` job of `checks.yml` | 🟢 accepted |
| [0018](0018-webgl2-or-an-opted-in-canvas-fallback.md) | Comb draws with WebGL2, and on Canvas 2D only where the host application opts in | `createComb` and `CombOptions` in `packages/comb/src/api/`, the error types `comb` exports, and the edges layer in `packages/comb/src/render/` | 🟢 accepted |
| [0019](0019-the-host-hands-comb-its-engine.md) | The host application hands Comb the engine's WebAssembly; Comb requests nothing itself | `createComb` and `CombOptions` in `packages/comb/src/api/`, the loading of the engine in `packages/comb/src/bridge/`, the exports of `packages/comb/package.json`, the library build, and `scripts/check-bundle.sh` | 🟢 accepted |
| [0020](0020-pixijs-without-eval.md) | Comb installs PixiJS's code generation without eval before it creates a renderer | `createComb` in `packages/comb/src/api/`, how `packages/comb` imports `pixi.js`, and every host application that embeds Comb | 🟢 accepted |
| [0021](0021-a-trapped-engine-is-lost-for-the-page.md) | A trapped engine is lost for the page; Comb refuses every later call with a typed error and tells the host application | `packages/comb/src/bridge/`, `createComb` and the `Comb` interface in `packages/comb/src/api/`, the error types `comb` exports, and the render's animation frame | 🟢 accepted |
| [0022](0022-a-shell-mistake-is-refused-as-the-shells.md) | A number the shell computes is refused as the shell's mistake, never as malformed graph data | the refusals of the exports `hit`, `moveLabel`, `query`, and `translate` of `crates/engine-wasm/`, their generated types in `packages/comb/src/bridge/`, and the callers of those exports in `packages/comb/src/interaction/` and `packages/comb/src/render/` | 🟢 accepted |
| [0023](0023-the-engine-edits-its-graph-in-place.md) | The engine edits its graph in place, one node or edge at a time, reuses freed slots, and draws a node added last on top | `crates/engine/src/graph.rs`, `crates/engine/src/spatial.rs`, the exports of `crates/engine-wasm` that add and remove nodes and edges, the order in which `packages/comb/src/render/` binds node views and particles, and the map from identifiers to slots and the per-slot lists of `packages/comb/src/store/` | 🟢 accepted |
| [0024](0024-edits-are-reported-as-typed-changes.md) | Comb applies edits at once, reports every change through one listener as a typed change, and lets the host application refuse a user's connection or deletion, a veto during whose call Comb tells a change ending its gesture with nothing done | `CombOptions` and the `Comb` interface in `packages/comb/src/api/`, the change types `comb` exports, the store's actions in `packages/comb/src/store/`, and the gestures of `packages/comb/src/interaction/` that change the graph | 🟢 accepted |
| [0025](0025-one-connector-per-side.md) | Every node has one connector in the middle of each side, and an edge records the side it leaves and the side it enters | the edge paths of `crates/engine/src/geometry.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer of `packages/comb/src/render/` | 🟢 accepted |
| [0026](0026-the-host-asks-the-height-content-lays-out-to.md) | The host application asks Comb the height a node's content lays out to | the `Comb` interface in `packages/comb/src/api/`, its export in `crates/engine-wasm/`, the height the engine computes in `crates/engine/src/content.rs`, and every host application that places nodes by their height, `examples/metric-tree` among them | 🟢 accepted |
| [0027](0027-a-drag-or-an-edit-redraws-what-it-changed.md) | A drag, or an edit at the far level, redraws what it changed in a moving layer, and the scene keeps its query | the scene's culling and binding in `packages/comb/src/render/`, the edge meshes of `crates/engine` and `crates/engine-wasm` and their export in `packages/comb/src/bridge/`, the store's signals of a move and of an added node in `packages/comb/src/store/`, and the node drag of `packages/comb/src/interaction/` | 🟢 accepted |
| [0028](0028-the-benchmark-drives-a-chrome-on-the-host.md) | The benchmark can drive a Chrome on the host, through its debugging port bridged to the Dev Container | `bench/run.ts` and its tests under `bench/`, `.devcontainer/devcontainer.json`, and the **Benchmark** part of `README.md` | 🟢 accepted |
| [0029](0029-the-benchmark-can-slow-the-measured-pages-cpu.md) | The benchmark can slow the measured page's CPU, by a factor its record names | `bench/run.ts` and its tests under `bench/`, `bench/compare.ts`, and the **Benchmark** part of `README.md` | 🟢 accepted |
| [0030](0030-one-workspace-per-example.md) | A pure Rust engine as functional core, and a TypeScript shell around it, the shell refusing what only its map of identifiers knows, the graph within a world's limit, and one workspace for each example | the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules | 🟢 accepted |
| [draft-node-shapes](draft-node-shapes.md) | A node is drawn and hit in a node shape from a closed set the engine owns | the node fields of `crates/engine-wasm/` and of `NodeData` in `packages/comb/src/store/`, the node-shape geometry of `crates/engine`, the layout of content and `heightOf` in `crates/engine/src/content.rs` and `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs`, and the drawing of nodes in `packages/comb/src/render/` | 🟢 accepted |
| [draft-edges-dock-on-a-side-or-the-outline](draft-edges-dock-on-a-side-or-the-outline.md) | Every node has one connector in the middle of each side, an edge's end docks on a side or on the node's outline, and a loop is accepted where the host application allows loops | the edge paths of `crates/engine/src/geometry.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, `CombOptions` and `addEdge` in `packages/comb/src/api/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer of `packages/comb/src/render/` | 🟡 proposed |
| [draft-the-benchmark-measures-a-graph-by-name](draft-the-benchmark-measures-a-graph-by-name.md) | The benchmark measures the graph a run names, the metric tree or a shaped one, each against baselines of its own | `bench/run.ts`, `bench/compare.ts`, `bench/options.ts` and their tests under `bench/`, `bench/baselines/`, `.github/workflows/benchmark.yml`, the query of the metric tree's example in `examples/metric-tree/src/`, and the **Benchmark** part of `README.md` | 🟡 proposed |

### Superseded and rejected

The record of what was decided against or replaced: read one when a change touches what it
governed, to learn why the current decision stands. A row moves here in the change that
flips its status.

| ADR | Title | Applies to | Status |
|-----|-------|------------|--------|
| [0009](0009-functional-core-imperative-shell.md) | A pure Rust engine as functional core, and a TypeScript shell around it, the shell refusing what only its map of identifiers knows, and the graph within a world's limit | the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules | ⚪ superseded by [ADR-0030](0030-one-workspace-per-example.md) |
