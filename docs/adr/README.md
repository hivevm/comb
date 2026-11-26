# Architecture Decision Records

This directory contains all Architecture Decision Records (ADRs) for this project. Accepted ADRs are
**binding** for humans and coding agents alike (see [`AGENTS.md`](../../AGENTS.md) in the repository
root). ADRs derive from the specification in [`docs/SPECIFICATION.md`](../SPECIFICATION.md).

## Mechanics

The rules live in three `NUC-` ADRs.
[NUC-decisions-are-proposed-then-accepted](NUC-decisions-are-proposed-then-accepted.md) decides
when an ADR is written, how it is developed, who flips its status, and that an accepted one is
immutable. [NUC-adrs-are-named-by-category](NUC-adrs-are-named-by-category.md) decides how it is
named, cited, superseded, and indexed. [NUC-base-is-fixed](NUC-base-is-fixed.md) decides the fixed
base. This section carries only the mechanics of the record;
[`scripts/check-docs.sh`](../../scripts/check-docs.sh) names in its header which of them it
verifies.

- **File.** Copy [`template.md`](template.md) to `<CAT>-<slug>.md` and head it
  `# <CAT>-<slug>: <title>`, the category from the [list](#categories). The author picks the
  identifier when creating the file, and it never changes or returns
  ([NUC-adrs-are-named-by-category §1](NUC-adrs-are-named-by-category.md)).
- **Wording.** The *Decision* and the *Enforcement* follow the writing rule of
  [`AGENTS.md` §4](../../AGENTS.md#4-working-style).
- **Index.** The tables below list the project's ADRs, grouped by category, and no `NUC-` ADR
  ([NUC-adrs-are-named-by-category §5](NUC-adrs-are-named-by-category.md)). They change in the same
  commit as the ADR they describe, for additions, supersessions, and status flips alike. The status
  is shown via the legend's bullet and the ADR's `Applies to` header is mirrored verbatim in its own
  column. The index routes a reader from a change to the decisions that bind it, so a row says what
  its ADR governs without the file being opened. Two tables keep what a session reads apart from
  what it looks up: an accepted or proposed ADR sits under **Binding**, a superseded or rejected one
  under **Superseded and rejected**, and a status flip moves the row.
- **Identifiers are permanent once on `main`.** A normalization keeps them, and only a merged or
  split ADR takes a new one
  ([NUC-decisions-are-proposed-then-accepted §8](NUC-decisions-are-proposed-then-accepted.md)).
  Between two normalizations, never rename, delete, or merge an ADR there: other ADRs, commits
  (`Implements <CAT>-<slug>`), and code cite it. A superseded ADR keeps its file and its body. The
  superseding ADR's `Supersedes` field names it from the proposal on; its `Status` line flips to
  `⚪ superseded by <CAT>-<slug>` in the change where a human accepts the successor
  ([NUC-adrs-are-named-by-category §4](NUC-adrs-are-named-by-category.md)), its index row moving
  with it.
- **Between normalizations, sprawl is curbed by supersession, never by editing.** One ADR may
  supersede several whose decisions have grown into one. Its `Supersedes` field names each, and
  each flips its status when the superseding ADR is accepted, so the set an agent reads shrinks
  while every identifier and every body stays.
- **A normalization restates the record**
  ([NUC-decisions-are-proposed-then-accepted §8](NUC-decisions-are-proposed-then-accepted.md)).
  - **Start.** The tree has no proposed ADR, no feature spec or ticket under `docs/plan/`, and
    green checks.
  - **Steps.** Three, in this order on one branch, each handed to the human and confirmed
    before the next begins: the restated specification, whose `G-n` and `Q-n` run from 1; the
    supersessions it calls for; and the restated record. The record begins once the human has
    decided each supersession. One pull request lands them, merged by a human.
  - **Identifiers.** An ADR restated alone keeps its identifier; a merged or split one takes a
    new one. The `NUC-` files stay as the release brought them.
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
    commit body, and in no document. A commit older than the normalization cites the identifiers
    it had then.
- **Cite only what exists.** Every citation, `<CAT>-<slug>` or a clause `<CAT>-<slug> §n`, names a
  file already in this directory. An anticipated follow-up is described by topic ("a follow-up ADR
  on session storage"). What counts as a citation, and its form in Markdown, is
  [NUC-adrs-are-named-by-category §6](NUC-adrs-are-named-by-category.md).

## Index

**The base:** the template's `NUC-` ADRs in this directory, each named with its blob in
[`NUC.blobs`](NUC.blobs), as `AGENTS.md` is. They bind like any ADR in force, and a project
extends or narrows a clause in an ADR of its own, never edits one
([NUC-base-is-fixed §1](NUC-base-is-fixed.md)).

### Categories

The category of an identifier says what its decision is about
([NUC-adrs-are-named-by-category §2](NUC-adrs-are-named-by-category.md)). The fixed ones:

- **NUC** — the template's own ADRs, reserved to the template repository.
- **SEC** — security.
- **OPS** — build, release, deployment, and operation.
- **API** — interfaces the system offers and consumes, adapters among them.

The project's own follow here, each in the same form with one line on what it holds:

- **ARCH** — the shape of the code: the engine as functional core, the shell around it, the store,
  and how the engine keeps its graph.
- **REN** — what the canvas draws and how: the scene, the levels of detail, node content, node
  shapes, and the renderer.
- **PERF** — the benchmark that decides every performance claim, and how it measures.
- **DEV** — the working environment: the agents' harness, the toolchain, and the Dev Container.

**Status legend:** 🟢 accepted · 🟡 proposed · 🔴 rejected · ⚪ superseded

### Binding

The decisions in force: accepted, and proposed ones that bind the work implementing them. This
is the table a session reads.

| ADR | Title | Applies to | Status |
|-----|-------|------------|--------|
| [SEC-actions-pinned-by-sha](SEC-actions-pinned-by-sha.md) | Workflows reference actions by full commit SHA, kept current by Dependabot | every `uses:` line under `.github/workflows/`, `.github/dependabot.yml`, `scripts/check-all.sh`, and the `sensors` job of `checks.yml` | 🟢 accepted |
| [SEC-no-container-engine](SEC-no-container-engine.md) | The work inside the Dev Container reaches no container engine | `.devcontainer/`, every test that would need a service or a container, `scripts/check-container.sh`, `scripts/test-check-container.sh`, and `.github/workflows/devcontainer.yml` | 🟢 accepted |
| [SEC-no-secrets-in-repository](SEC-no-secrets-in-repository.md) | The repository holds no secrets and relies on GitHub's baseline | the repository, its CI workflows, and the repository settings | 🟢 accepted |
| [SEC-pixijs-without-eval](SEC-pixijs-without-eval.md) | Comb installs PixiJS's code generation without eval before it creates a renderer | `createComb` in `packages/comb/src/api/`, how `packages/comb` imports `pixi.js`, and every host application that embeds Comb | 🟢 accepted |
| [OPS-measuring-workflows-are-no-gate](OPS-measuring-workflows-are-no-gate.md) | A workflow that measures what the local gate cannot is no gate, and a script a listed one runs counts where that one runs | the `# Not a gate:` and `# On instruction:` lines of `scripts/check-all.sh`, the rule `docs/check-lists` of `scripts/check-docs.sh` and its cases in `scripts/fixtures/check-docs-record.txt`, `.github/workflows/benchmark.yml`, `.github/workflows/mutation.yml`, `.github/workflows/devcontainer.yml` | 🟢 accepted |
| [API-bridge-columns-carry-nesting](API-bridge-columns-carry-nesting.md) | Structured data crosses the bridge through serde-wasm-bindgen with generated types, a load's graph data and node content as columns whose strings cross in pieces, coordinate streams through typed-array views on engine-owned buffers | `crates/engine-wasm/`, `packages/comb/src/bridge/`, the snapshot of a load in `packages/comb/src/api/snapshot.ts`, and every value that crosses between them | 🟢 accepted |
| [API-bridge-columns-keep-no-size](API-bridge-columns-keep-no-size.md) | Structured data crosses the bridge through serde-wasm-bindgen with generated types, a load's graph data and node content as columns whose strings cross in pieces, coordinate streams through typed-array views on engine-owned buffers, and the store keeps no node's size, which every reader takes from those buffers | `crates/engine-wasm/`, `packages/comb/src/bridge/`, the snapshot of a load in `packages/comb/src/api/snapshot.ts`, every value that crosses between them, the node views of `packages/comb/src/store/`, and the readers of a node's size in `packages/comb/src/render/connectors.ts`, `packages/comb/src/render/particles.ts`, `packages/comb/src/render/nodes.ts`, `packages/comb/src/api/index.ts`, and `packages/comb/src/api/changes.ts` | 🟡 proposed |
| [API-edges-dock-nodes-or-edges](API-edges-dock-nodes-or-edges.md) | Every node has one connector in the middle of each side, an edge's end docks on a side or on the outline of any node, at any depth, or on another edge, and an edge carries a list of edge labels | the edge paths of `crates/engine/src/geometry.rs`, the point where a loop's end meets a node shape's outline in `crates/engine/src/shape.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, `CombOptions`, `addEdge`, and `updateEdge` in `packages/comb/src/api/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer and the edge labels of `packages/comb/src/render/` | 🟢 accepted |
| [API-edits-report-nested-changes](API-edits-report-nested-changes.md) | Comb applies edits at once, reports every change through one listener as a typed change, and lets the host application refuse a user's connection, deletion, or move into a container, a veto during whose call Comb tells a change ending the gesture with nothing done | `CombOptions` and the `Comb` interface in `packages/comb/src/api/`, the change types `comb` exports, the store's actions in `packages/comb/src/store/`, the gestures of `packages/comb/src/interaction/` that change the graph, and the fields of `NodeData` for containers, regions, border nodes, and resizing | 🟢 accepted |
| [API-export-apply-change](API-export-apply-change.md) | Comb exports the function that applies a change to the host application's copy of the graph | the exports of `packages/comb/src/index.ts`, the change types and the patch merge of `packages/comb/src/api/`, and every host application that keeps a copy of the graph from `onChange`, `examples/metric-tree/src/main.ts` and `examples/uml/src/diagram.ts` among them | 🟡 proposed |
| [API-host-hands-comb-engine](API-host-hands-comb-engine.md) | The host application hands Comb the engine's WebAssembly; Comb requests nothing itself | `createComb` and `CombOptions` in `packages/comb/src/api/`, the loading of the engine in `packages/comb/src/bridge/`, the exports of `packages/comb/package.json`, the library build, and `scripts/check-bundle.sh` | 🟢 accepted |
| [API-shell-mistake-refused-as-shells](API-shell-mistake-refused-as-shells.md) | A number the shell computes is refused as the shell's mistake, never as malformed graph data | the refusals of the exports `hit`, `moveLabel`, `query`, and `translate` of `crates/engine-wasm/`, their generated types in `packages/comb/src/bridge/`, and the callers of those exports in `packages/comb/src/interaction/` and `packages/comb/src/render/` | 🟢 accepted |
| [API-trapped-engine-is-lost](API-trapped-engine-is-lost.md) | A trapped engine is lost for the page; Comb refuses every later call with a typed error and tells the host application | `packages/comb/src/bridge/`, `createComb` and the `Comb` interface in `packages/comb/src/api/`, the error types `comb` exports, and the render's animation frame | 🟢 accepted |
| [ARCH-border-nodes-ride-sides](ARCH-border-nodes-ride-sides.md) | A border node sits on a side of the node it is attached to, at an offset along that side, and moves with it | border nodes in `crates/engine/src/graph.rs`, `crates/engine/src/shape.rs`, `crates/engine-wasm/`, and `packages/comb/src/store/`, their drawing in `packages/comb/src/render/`, and their drag in `packages/comb/src/interaction/` | 🟢 accepted |
| [ARCH-engine-edits-nested-graph](ARCH-engine-edits-nested-graph.md) | The engine edits its graph in place, one node or edge at a time, reuses freed slots, nests nodes in containers, and draws containers below the other nodes | `crates/engine/src/graph.rs`, `crates/engine/src/spatial.rs`, the exports of `crates/engine-wasm` that add and remove nodes and edges, the order in which `packages/comb/src/render/` binds node views and particles, and the map from identifiers to slots and the per-slot lists of `packages/comb/src/store/` | 🟢 accepted |
| [ARCH-graph-in-zustand-store](ARCH-graph-in-zustand-store.md) | The graph's structure and what the pointer is over live in a vanilla Zustand store; no coordinate does, and each kind of move is signalled by a counter of its own, an added node by its slot | `packages/comb/src/store/`, the state `packages/comb/src/interaction/` keeps between pointer events, and every module that reads or writes the state of the graph or the viewport | 🟢 accepted |
| [ARCH-one-workspace-per-example](ARCH-one-workspace-per-example.md) | A pure Rust engine as functional core, and a TypeScript shell around it, the shell refusing what only its map of identifiers knows, the graph within a world's limit, and one workspace for each example | the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules | 🟢 accepted |
| [ARCH-regions-are-container-slots](ARCH-regions-are-container-slots.md) | A node's regions are containers the engine keeps in slots of their own, inside the node they divide | the regions of a node in `crates/engine/src/graph.rs`, `crates/engine-wasm/`, and `packages/comb/src/store/`, the drawing of regions in `packages/comb/src/render/`, and the drag of a line between regions in `packages/comb/src/interaction/` | 🟢 accepted |
| [REN-moving-layer-moves-content](REN-moving-layer-moves-content.md) | A drag, or an edit at the far level, redraws what it changed in a moving layer, a dragged container with what it contains, and the scene keeps its query | the scene's culling and binding in `packages/comb/src/render/`, the edge meshes of `crates/engine` and `crates/engine-wasm` and their export in `packages/comb/src/bridge/`, the store's signals of a move and of an added node in `packages/comb/src/store/`, and the node drag of `packages/comb/src/interaction/` | 🟢 accepted |
| [REN-node-content-and-hits](REN-node-content-and-hits.md) | Node content is a closed set of elements in rows, laid out by the engine, in a node as high as its content or the height its data gives, and one hit test finds handles, region lines, connectors, labels, nodes, and edges | the node-content types of `crates/engine` and `crates/engine-wasm`, their generated TypeScript definitions in `packages/comb`, the layout functions of the engine, the drawing of node content in `packages/comb/src/render/`, the report of a click on a content element in `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs` and its export in `crates/engine-wasm/`, the label extents the render layer of `packages/comb/src/render/` hands the engine, the press and hover of `packages/comb/src/interaction/`, and `Comb.heightOf` in `packages/comb/src/api/` with its export in `crates/engine-wasm/` | 🟢 accepted |
| [REN-node-shapes-cover-uml](REN-node-shapes-cover-uml.md) | A node is drawn and hit in a node shape from a closed set the engine owns, grown to the node shapes of UML's activity, use case, and state diagrams, with an outline the host application can dash or leave out | the node fields of `crates/engine-wasm/` and of `NodeData` in `packages/comb/src/store/`, the node-shape geometry of `crates/engine`, the layout of content and `heightOf` in `crates/engine/src/content.rs` and `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs`, and the drawing of nodes in `packages/comb/src/render/` | 🟢 accepted |
| [REN-virtualized-nested-scene](REN-virtualized-nested-scene.md) | A virtualized scene graph with culling by the engine and three levels of detail, containers drawn below the edges, nodes bound in the engine's order | `packages/comb/src/render/`, and the exports of `crates/engine` and `crates/engine-wasm` that answer spatial queries and compute edge geometry | 🟢 accepted |
| [REN-webgl2-or-canvas-fallback](REN-webgl2-or-canvas-fallback.md) | Comb draws with WebGL2, and on Canvas 2D only where the host application opts in | `createComb` and `CombOptions` in `packages/comb/src/api/`, the error types `comb` exports, and the edges layer in `packages/comb/src/render/` | 🟢 accepted |
| [PERF-benchmark-drives-host-chrome](PERF-benchmark-drives-host-chrome.md) | The benchmark can drive a Chrome on the host, through its debugging port bridged to the Dev Container | `bench/run.ts` and its tests under `bench/`, `.devcontainer/devcontainer.json`, and the **Benchmark** part of `README.md` | 🟢 accepted |
| [PERF-benchmark-measures-named-graph](PERF-benchmark-measures-named-graph.md) | The benchmark measures the graph a run names, the metric tree or a shaped one, each against baselines of its own | `bench/run.ts`, `bench/compare.ts`, `bench/options.ts` and their tests under `bench/`, `bench/baselines/`, `.github/workflows/benchmark.yml`, the query of the metric tree's example in `examples/metric-tree/src/`, and the **Benchmark** part of `README.md` | 🟡 proposed |
| [PERF-benchmark-slows-page-cpu](PERF-benchmark-slows-page-cpu.md) | The benchmark can slow the measured page's CPU, by a factor its record names | `bench/run.ts` and its tests under `bench/`, `bench/compare.ts`, and the **Benchmark** part of `README.md` | 🟢 accepted |
| [DEV-bun-vite-wasm-pack](DEV-bun-vite-wasm-pack.md) | TypeScript with Bun, Vite, Playwright, ESLint, and Prettier; Rust with wasm-pack, cargo test, clippy, and rustfmt | `package.json`, `bun.lock`, `Cargo.toml`, the lint and formatter configurations, `scripts/check-code.sh`, `scripts/check-all.sh`, `scripts/check-dependencies.sh`, `scripts/check-mutants.sh`, `crates/engine/mutants-missed.txt`, `bench/`, `playwright.config.ts`, `.github/workflows/`, and the **Build, Test & Run** section of `README.md` | 🟢 accepted |
| [DEV-commit-checks-on-instruction](DEV-commit-checks-on-instruction.md) | The checks on each commit of a branch run on a human's instruction, before its integration | `scripts/check-commits.sh`, its `# On instruction:` line in `scripts/check-all.sh`, and step 2 of the integration branches in `CONTRIBUTING.md` | 🟢 accepted |
| [DEV-container-adds-bun-and-rust](DEV-container-adds-bun-and-rust.md) | The Dev Container builds from a Dockerfile that adds Bun, and takes Rust as a locked Feature | `.devcontainer/`, `.vscode/launch.json`, `.vscode/extensions.json`, the CI job that sets up the toolchain, `scripts/check-container.sh`, `scripts/test-check-container.sh`, and `.github/workflows/devcontainer.yml` | 🟢 accepted |
| [DEV-gh-login-outlives-rebuild](DEV-gh-login-outlives-rebuild.md) | The Dev Container keeps its GitHub login in the host's `~/.config/gh` | the mounts, `initializeCommand`, and `postStartCommand` of `.devcontainer/devcontainer.json`, `scripts/check-devcontainer.sh`, and `scripts/test-check-devcontainer.sh` | 🟢 accepted |
| [DEV-implementer-and-fresh-reviewer](DEV-implementer-and-fresh-reviewer.md) | One agent implements, a fresh session reviews, and the protected parts stay with the maintainer | every change and every agent session in this repository, `docs/adr/`, `docs/SPECIFICATION.md`, `.github/CODEOWNERS`, and the tickets under `docs/plan/` | 🟢 accepted |
| [DEV-tickets-integrate-on-feat-branch](DEV-tickets-integrate-on-feat-branch.md) | The tickets of a spec the human assigns to a `feat/` branch are claimed and worked there, one after another, their blockers closed on that branch | the frontier and the claim of a ticket whose spec the human assigned to a `feat/` branch, its ticket branch, and its integration on that branch | 🟢 accepted |

### Superseded and rejected

The record of what was decided against or replaced: read one when a change touches what it
governed, to learn why the current decision stands. A row moves here in the change that
flips its status.

| ADR | Title | Applies to | Status |
|-----|-------|------------|--------|
| [API-bridge-takes-serde-and-columns](API-bridge-takes-serde-and-columns.md) | Structured data crosses the bridge through serde-wasm-bindgen with generated types, a load's graph data and node content as columns whose strings cross in pieces, coordinate streams through typed-array views on engine-owned buffers | `crates/engine-wasm/`, `packages/comb/src/bridge/`, the snapshot of a load in `packages/comb/src/api/snapshot.ts`, and every value that crosses between them | ⚪ superseded by [API-bridge-columns-carry-nesting](API-bridge-columns-carry-nesting.md) |
| [API-edges-dock-side-or-outline](API-edges-dock-side-or-outline.md) | Every node has one connector in the middle of each side, an edge's end docks on a side or on the node's outline, and a loop is accepted where the host application allows loops | the edge paths of `crates/engine/src/geometry.rs`, the point where a loop's end meets a node shape's outline in `crates/engine/src/shape.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, `CombOptions` and `addEdge` in `packages/comb/src/api/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer of `packages/comb/src/render/` | ⚪ superseded by [API-edges-dock-nodes-or-edges](API-edges-dock-nodes-or-edges.md) |
| [API-edits-reported-as-typed-changes](API-edits-reported-as-typed-changes.md) | Comb applies edits at once, reports every change through one listener as a typed change, and lets the host application refuse a user's connection or deletion, a veto during whose call Comb tells a change ending its gesture with nothing done | `CombOptions` and the `Comb` interface in `packages/comb/src/api/`, the change types `comb` exports, the store's actions in `packages/comb/src/store/`, and the gestures of `packages/comb/src/interaction/` that change the graph | ⚪ superseded by [API-edits-report-nested-changes](API-edits-report-nested-changes.md) |
| [API-host-asks-content-height](API-host-asks-content-height.md) | The host application asks Comb the height a node's content lays out to | the `Comb` interface in `packages/comb/src/api/`, its export in `crates/engine-wasm/`, the height the engine computes in `crates/engine/src/content.rs`, and every host application that places nodes by their height, `examples/metric-tree` among them | ⚪ superseded by [REN-node-content-and-hits](REN-node-content-and-hits.md) |
| [API-one-connector-per-side](API-one-connector-per-side.md) | Every node has one connector in the middle of each side, and an edge records the side it leaves and the side it enters | the edge paths of `crates/engine/src/geometry.rs`, the edge records of `crates/engine/src/graph.rs`, the edge fields of `crates/engine-wasm/` and of `EdgeData` in `packages/comb/src/store/`, the connect gesture of `packages/comb/src/interaction/`, and the connectors layer of `packages/comb/src/render/` | ⚪ superseded by [API-edges-dock-side-or-outline](API-edges-dock-side-or-outline.md) |
| [ARCH-engine-edits-graph-in-place](ARCH-engine-edits-graph-in-place.md) | The engine edits its graph in place, one node or edge at a time, reuses freed slots, and draws a node added last on top | `crates/engine/src/graph.rs`, `crates/engine/src/spatial.rs`, the exports of `crates/engine-wasm` that add and remove nodes and edges, the order in which `packages/comb/src/render/` binds node views and particles, and the map from identifiers to slots and the per-slot lists of `packages/comb/src/store/` | ⚪ superseded by [ARCH-engine-edits-nested-graph](ARCH-engine-edits-nested-graph.md) |
| [ARCH-functional-core-imperative-shell](ARCH-functional-core-imperative-shell.md) | A pure Rust engine as functional core, and a TypeScript shell around it, the shell refusing what only its map of identifiers knows, and the graph within a world's limit | the directory layout, `crates/`, `packages/`, `examples/`, and every import between their modules | ⚪ superseded by [ARCH-one-workspace-per-example](ARCH-one-workspace-per-example.md) |
| [REN-closed-set-of-node-shapes](REN-closed-set-of-node-shapes.md) | A node is drawn and hit in a node shape from a closed set the engine owns | the node fields of `crates/engine-wasm/` and of `NodeData` in `packages/comb/src/store/`, the node-shape geometry of `crates/engine`, the layout of content and `heightOf` in `crates/engine/src/content.rs` and `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs`, and the drawing of nodes in `packages/comb/src/render/` | ⚪ superseded by [REN-node-shapes-cover-uml](REN-node-shapes-cover-uml.md) |
| [REN-moving-layer-redraws-changes](REN-moving-layer-redraws-changes.md) | A drag, or an edit at the far level, redraws what it changed in a moving layer, and the scene keeps its query | the scene's culling and binding in `packages/comb/src/render/`, the edge meshes of `crates/engine` and `crates/engine-wasm` and their export in `packages/comb/src/bridge/`, the store's signals of a move and of an added node in `packages/comb/src/store/`, and the node drag of `packages/comb/src/interaction/` | ⚪ superseded by [REN-moving-layer-moves-content](REN-moving-layer-moves-content.md) |
| [REN-node-content-in-rows](REN-node-content-in-rows.md) | Node content is a closed set of elements in rows, laid out by the engine | the node-content types of `crates/engine` and `crates/engine-wasm`, their generated TypeScript definitions in `packages/comb`, the layout functions of the engine, the drawing of node content in `packages/comb/src/render/`, the report of a click on a content element in `packages/comb/src/api/`, the hit test of `crates/engine/src/graph.rs` and its export in `crates/engine-wasm/`, the label extents the render layer of `packages/comb/src/render/` hands the engine, and the press and hover of `packages/comb/src/interaction/` | ⚪ superseded by [REN-node-content-and-hits](REN-node-content-and-hits.md) |
| [REN-virtualized-scene-graph](REN-virtualized-scene-graph.md) | A virtualized scene graph with culling by the engine and three levels of detail, nodes bound by rank | `packages/comb/src/render/`, and the exports of `crates/engine` and `crates/engine-wasm` that answer spatial queries and compute edge geometry | ⚪ superseded by [REN-virtualized-nested-scene](REN-virtualized-nested-scene.md) |
| [DEV-bun-vite-and-wasm-pack](DEV-bun-vite-and-wasm-pack.md) | TypeScript with Bun, Vite, Playwright, ESLint, and Prettier; Rust with wasm-pack, cargo test, clippy, and rustfmt | `package.json`, `bun.lock`, `Cargo.toml`, the lint and formatter configurations, `scripts/check-code.sh`, `scripts/check-all.sh`, `scripts/check-dependencies.sh`, `scripts/check-mutants.sh`, `crates/engine/mutants-missed.txt`, `bench/`, `playwright.config.ts`, `.github/workflows/`, and the **Build, Test & Run** section of `README.md` | ⚪ superseded by [DEV-bun-vite-wasm-pack](DEV-bun-vite-wasm-pack.md) |
