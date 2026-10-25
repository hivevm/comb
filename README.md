# Comb

[![Checks](https://github.com/hivevm/comb/actions/workflows/checks.yml/badge.svg)](https://github.com/hivevm/comb/actions/workflows/checks.yml)

**Comb** is a high-performance, interactive node-editor framework for the browser, built to stay
responsive with tens of thousands of nodes. The work is driven by a written **specification**
([`docs/SPECIFICATION.md`](docs/SPECIFICATION.md)) and **Architecture Decision Records**
([`docs/adr/`](docs/adr/)), so intent and the reasoning behind every structural choice stay
explicit and reviewable.

> For agent instructions, see [`AGENTS.md`](AGENTS.md), the single source of truth for all coding
> agents.

## Overview

Comb draws nodes, edges, connectors, and edge labels on a WebGL2 canvas with PixiJS and lets the
user create, connect, move, and delete them directly; every form for their attributes stays in the
host application's HTML. Geometry runs in a Rust engine compiled to WebAssembly. It is built for
developers whose web applications edit graphs of tens of thousands of nodes. The full problem
statement and goals live in [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md), the vocabulary in
[`docs/GLOSSARY.md`](docs/GLOSSARY.md).

## Prerequisites

- [VS Code](https://code.visualstudio.com/) with the
  [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
  extension, or any DevContainer-compatible IDE
- Docker / Podman (rootless) available on the host

## Getting Started

1. Open the repository in VS Code and choose **Reopen in Container**. The Dev Container and the
   preconfigured agent extensions build automatically, and the container enables the repository's
   git hooks ([`.githooks/`](.githooks/)): no commit on `main`, the checks run before a push, and
   the documentation checks run before a merge commit on `main`.
   Working outside the container? Enable them yourself, once per clone:
   `git config core.hooksPath .githooks`.
2. Authenticate your coding agent inside the container (for Claude Code: `claude login`).
3. Start working with the agent. Drive the work from the specification and the ADRs.

## Build, Test & Run

Inside the Dev Container, which provides Bun, Rust, wasm-pack, and Chromium
([ADR-0008](docs/adr/0008-toolchain.md), [ADR-0014](docs/adr/0014-dev-container-toolchain.md)).
[`scripts/check-code.sh`](scripts/check-code.sh) runs, in order, the structural check of
[ADR-0028](docs/adr/0028-the-graph-lies-within-a-world.md), the dependency check, and the
overview check of [ADR-0001](docs/adr/0001-agent-governance-model.md), each after its self-test,
and the self-test of the engine check; then the first three below,
build, lint, and test; then the bundle budget of Q-3 after its self-test (`bun run build:lib`, at
most 300 kB gzipped without PixiJS).

- **Build:** `bun run build` — the engine with wasm-pack, the type check, and the example
- **Test:** `bun run test` — `cargo test`, `bun test`, and the Playwright browser tests; it
  refuses to start on a missing engine or one older than a file under `crates/` that a build
  reads, than `Cargo.toml`, or than `Cargo.lock` (`scripts/check-engine.sh`), naming the file and
  `bun run build:engine`; so does `bun run dev`, which serves the example to Playwright
- **Lint:** `bun run lint` — rustfmt, clippy, ESLint, and Prettier
- **Run:** `bun run example`, or the launch configuration **Example: metric tree** in VS Code,
  which opens the example in the host's browser; `?copies=3334` opens it with 50,010 nodes
- **Benchmark:** `bun run bench` — the example at 50,010 nodes and edges in Chromium: time to the
  first frame and p95 frame times of drag, pan, and zoom against Q-1 and Q-2, written to
  `bench-results/latest.json`. `BENCH_HEADED=1` opens a window that uses the machine's GPU, which
  is how the numbers on the reference machine are taken; `BENCH_COPIES` sets another size.
  After the load and the first frame, before the gestures, each run times a fixed reference
  workload in the same page (`bench/reference.ts`: a JavaScript loop, a WebAssembly loop, and a
  WebGL2 draw of a fixed mesh), recorded as `reference` with its parts. The **Benchmark** workflow
  runs it three times on a GitHub runner, weekly and on demand (*Actions* → *Benchmark* → *Run
  workflow*), and fails when the median of a number exceeds the baseline of the runner's kind,
  the CPU model the run records, under `bench/baselines/` by more than 25 %, naming it. The
  reference is a gate within a kind: when a part of it differs from the kind's baseline by more
  than 25 %, either way, the runner is not comparable and the comparison is refused, naming the
  parts; every part's ratio to the baseline is in the log. The runs and their median are
  uploaded as the artefact `bench-results` (`bun bench/compare.ts bench/baselines <run>...`
  compares locally; a run in the Dev Container is refused, since its CPU model has no baseline,
  unless a baseline recorded on the same CPU model is passed). The maintainer records a kind's
  baseline: take `median.json` from the artefact of a workflow run on `main` on that kind, save it
  under the file name the refusal prints, and open a pull request that says why. Against a
  baseline without a reference, the comparison says that the runner gate is not checked and
  judges the numbers alone. A runner's numbers are compared only with a runner's of its kind:
  runs on a kind without a baseline or naming no CPU model, runs of another size, mode, or GPU
  than the baseline's, runs that name no GPU, and runs without a reference against a baseline
  with one are refused.
- **Mutation testing:** `cargo mutants -p comb-engine --no-shuffle --timeout 30` mutates
  `crates/engine` and runs its tests against each mutant, in about half an hour, writing
  `mutants.out/`; it needs cargo-mutants 27.1.0
  (`cargo install cargo-mutants --version 27.1.0 --locked`).
  `bash scripts/check-mutants.sh mutants.out crates/engine/mutants-missed.txt` then compares the
  survivors with the recorded list by file, function, and replacement, not by line, and fails
  naming each survivor the list does not, or when the run caught no mutant. It reports each
  listed survivor now caught, and each listed survivor whose tests timed out as timed out, not
  caught: a timeout neither fails the run nor shrinks the list. The key does not tell mutants of
  one function apart, so a listed survivor now caught and a new one under the same key in that
  function pass unnoticed.
  The **Mutation testing** workflow does both on a GitHub runner, weekly and on demand
  (*Actions* → *Mutation testing* → *Run workflow*), and uploads `mutants.out` as an artefact.
  The list shrinks with each change that kills a mutant: delete its line, or lower its count. It
  grows only in a pull request that says why each new survivor stays; a survivor no test can
  tell from the code, an equivalent mutant, carries its reason in the list after ` # `.
  `bash scripts/check-mutants.sh --record mutants.out crates/engine/mutants-missed.txt` prints
  the list of a run, each survivor with the reason the list gives it. The timeouts lie in
  `Point::lerp`, `distance_to_segment`, and `subdivide`: their mutants keep a path from ever
  getting flat enough, so edges are subdivided to the deepest level and the suite runs past the
  timeout. Those tried with a timeout of ten minutes were caught, their suite failing after 38 to
  110 seconds.

## Usage

A host application gives Comb an element to fill and the engine's WebAssembly, hands it the
graph, and keeps the forms:

```ts
import { createComb } from "comb";
import engineUrl from "comb/engine.wasm?url"; // Vite emits the file and gives its URL

const comb = await createComb(document.getElementById("canvas")!, {
  engine: fetch(engineUrl),
});
comb.load({
  nodes: [
    { id: "a", title: "Premium trial users", x: 0, y: 0, width: 220, height: 64 },
    { id: "b", title: "Time spent listening", x: 320, y: 0, width: 220, height: 64 },
  ],
  edges: [
    {
      id: "a-b",
      source: "a",
      target: "b",
      color: 0x22a55b,
      label: { text: "0.998", t: 0.5, offset: 0 },
    },
  ],
});
comb.fitView();
comb.onSelectionChange((selection) => console.log(selection)); // fill the sidebar from here
comb.onChange((change) => {
  if (change.kind === "nodeAdded") console.log(change.node.id, change.by); // "c", "host"
});
comb.addNode({ id: "c", title: "Churned users", x: 640, y: 0, width: 220, height: 64 });
```

`addNode` adds one node at its `x` and `y` without a load, drawn above every node it overlaps. For a
node dropped from the host application's palette, `comb.worldPointAt(event.clientX, event.clientY)`
returns the world point under the drop; Comb handles no drag and drop itself, and `worldPointAt`
throws a `RangeError` on a coordinate that is not finite. `removeNodes(ids)` removes those nodes and
every edge at them, and `removeEdges(ids)` those edges, without a load. `addEdge(edge)` adds an
edge between two nodes the graph holds, and `updateEdge(id, patch)` changes an edge's `color`,
`dash`, `arrow`, `label`, `sourceSide`, or `targetSide`, `null` clearing a dash or a label. An
edge leaves its source by `sourceSide` and enters its target by `targetSide`, each `top`, `right`,
`bottom`, or `left`, by default `right` and `left`. `onChange` tells every
change of the graph, a `GraphChange` that `comb` exports, typed by its `kind` and by `by`, `"user"`
or `"host"`: `loaded` after `load`, `nodeAdded` with the node as Comb took it after `addNode`,
`nodeUpdated` with the merged patch after `updateNode`, `nodesRemoved` with the nodes and the edges
that went with them after `removeNodes`, `edgesRemoved` with the edges after `removeEdges`,
`edgeAdded` with the edge as Comb keeps it, its colour and arrowhead filled, after `addEdge`,
`edgeUpdated` with the patch as merged after `updateEdge`, nothing
for a removal that names none, and `nodeMoved` with where the node lies, once, when the user
releases a node dragged, not per frame and not for a press that moved nothing. Each arrives before
the call or input event that made it returns, and before `onSelectionChange` reports a selection the
change cleared; `onChange` returns the function that removes the listener. A change a listener makes
reaches every listener after the change being delivered, so that each hears the changes in the order
made. A listener that throws keeps no other from being told; once all are told, its error is thrown
from the call that made the change, or for a change the user made from the input event, and the
graph holds the change all the same.

`load` throws a `GraphDataError` on graph data it refuses, `updateNode` one on a node the graph does
not hold or a patch it refuses, and `addNode` one on a node of an identifier the graph holds already
(`duplicateNode`), a node a load would refuse, or one past the limits of a load, and `removeNodes`
and `removeEdges` one on an identifier the graph does not hold among those they name (`unknownNode`,
`unknownEdge`) or identifiers that are no list of strings, `addEdge` one on an edge of an
identifier the graph holds (`duplicateEdge`), to a node it does not hold (`missingNode`), from a
node to itself (`selfEdge`, which a load accepts), one a load would refuse, or one past the limits
of a load, and `updateEdge` one on an edge the graph does not hold, a patch of another field
(`unknownEdgePatchField`), or a field a load would refuse; each keeps the graph it had and tells
`onChange` nothing (Q-7). The error's `problem` is a `GraphDataProblem`, which `comb` exports, and
its `kind` says what was wrong and where: `invalidField` for a field missing or of another type,
with the list, the index, the identifier where the item has one, the field, and what it expects;
`unknownNode` and `unknownEdge` for a node or an edge the graph does not hold; `malformed` for graph
data that is no object of node and edge lists; and a kind of its own for every other refusal, such
as `nonFiniteCoordinate` or `missingNode`. `problem.kind` narrows the union to the fields of its
kind. A `switch` on it without a `default` has to handle every kind, so that a kind a later version
adds fails the host application's type check; the example handles two and leaves the rest to a
`default`:

```ts
import { GraphDataError, type GraphDataProblem } from "comb";

function where(problem: GraphDataProblem): string {
  switch (problem.kind) {
    case "invalidField":
      return `${problem.list}[${problem.index}].${problem.field}: expected ${problem.expected}`;
    case "unknownNode":
      return `no node ${problem.node}`;
    default:
      return problem.kind;
  }
}

try {
  comb.load(graph);
} catch (error) {
  if (!(error instanceof GraphDataError)) throw error;
  console.warn(where(error.problem));
}
```

Comb makes no request of its own (Q-6). The host application requests the file `comb/engine.wasm`
however it serves its assets, so its Content Security Policy governs that request, and hands over
the `Response`, or a promise of one, a compiled `WebAssembly.Module`, or the bytes (an
`ArrayBuffer` or a view on one). `createComb` rejects with an `EngineSourceError` before it touches
the element where `engine`, or what its promise resolves to, is missing (`reason` `"missing"`), a
string, `URL`, or `Request`, which Comb would have to fetch itself (`"fetchable"`), or anything
else (`"invalid"`); `comb` exports the type of `reason`, `EngineSourceProblem`. The engine is
instantiated once per page: a later `createComb` checks its `engine` but reuses the first
instance.

Should the engine trap, as WebAssembly does when it runs out of memory, it is lost for the page, for
every Comb on it (ADR-0021). From then on `load`, `updateNode`, `addNode`, `addEdge`, `updateEdge`,
`removeNodes`,
`removeEdges`, `fitView`, `setViewport`,
and `createComb` throw an `EngineLostError`, which `comb` exports; `viewport`, `worldPointAt`,
`onSelectionChange`, `onChange`, and `destroy` keep working, the canvas keeps its last frame, and
input on it changes nothing. `comb.onEngineLost(listener)` calls `listener` once with the error, at
once where the engine is lost already, and returns the function that removes it. The only recovery
is loading the page anew, so a host application tells its user and offers a reload:

```ts
comb.onEngineLost(() => showBanner("The graph stopped responding. Reload the page."));
```

Comb runs under a Content Security Policy that allows `wasm-unsafe-eval` but not `unsafe-eval`,
such as `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'` (Q-6). For that it imports
PixiJS's module `pixi.js/unsafe-eval`, which replaces PixiJS's code generation with code that uses
no eval (ADR-0020). The module patches PixiJS's classes, so it reaches every PixiJS renderer on the
host application's page, also one the host application creates itself.

`createComb` throws a `RendererUnavailableError` where the browser offers no WebGL2. A host
application that would rather draw slowly, with dash patterns solid, than draw nothing opts into
PixiJS's Canvas 2D renderer:

```ts
const comb = await createComb(host, { engine: fetch(engineUrl), allowCanvasFallback: true });
```

[`examples/metric-tree/`](examples/metric-tree/) is a complete host application with a sidebar and a
palette, whose kinds the user drags onto the canvas to add a node under the drop. A click on a node
or an edge selects it, an edge within 4 screen pixels of its path, a drag from an edge beyond 4
pixels pans, and the sidebar edits a node's title or an edge's colour, line, arrowhead, and label.
With the canvas focused, which a press on it does, Delete or Backspace deletes the selection, a node
with every edge at it, once `CombOptions.canDelete` returns `true` for the identifiers of everything
that would go; without `canDelete` a deletion is allowed, and the host application's own
`removeNodes` and `removeEdges` never ask it. The deletion is told as `nodesRemoved` or
`edgesRemoved` with `by: "user"`. Where `CombOptions.canConnect` is set, hovering a
node shows its four connectors, and a drag from one to a connector of another node the source does
not reach yet connects them: `canConnect({ source, sourceSide, target, targetSide })` names the
new edge, checked as `addEdge` checks one, or refuses with `false`; the edge is told as
`edgeAdded` with `by: "user"`. Without `canConnect`, no connection begins. A veto during whose call
Comb tells a change to `onChange` ends its gesture with nothing done, whatever it returns. The
example names each edge after its ends. At the near level a press inside an edge label's pill
selects its edge and drags the label, which stays where it is dropped: the engine places it at the
nearest path parameter and the distance along the normal there, and the release is told as
`labelMoved` with that `t` and `offset`.

## Project Layout

```
README.md             # overview & setup for humans
AGENTS.md             # single source of truth for coding agents
docs/SPECIFICATION.md # the specification: problem, goals, success criteria
docs/GLOSSARY.md      # the vocabulary everyone uses, kept current inline
docs/CONVENTIONS.md   # how this project writes what no check decides, kept current inline
docs/ARCHITECTURE.md  # the system as it currently stands
docs/adr/             # Architecture Decision Records (+ template)
crates/engine/        # the engine's pure Rust core: geometry over values and buffers (ADR-0028)
crates/engine-wasm/   # the bridge's Rust side: every WebAssembly export (ADR-0010)
packages/comb/        # the library: api, store, interaction, render, bridge
examples/metric-tree/ # the example host application, with its browser tests (G-9)
scripts/              # consistency checks and sensors (check-all.sh runs them all), run in CI
.githooks/            # git hooks: refuse a commit on main, a push while the checks are red, and
                      # a merge commit on main while the documentation checks are red
.github/              # CI workflows, Dependabot, issue & pull request templates, code owners
.devcontainer/        # Dev Container definition (Dockerfile + Features)
.vscode/              # shared editor settings
.editorconfig         # editor-neutral formatting baseline
.gitattributes        # line-ending normalization (LF everywhere)
.agents/skills/       # the procedures of AGENTS.md as Agent Skills, one directory each (ADR-0003)
.claude/CLAUDE.md     # pointer for Claude Code to read AGENTS.md
.claude/skills/       # pointers (one symlink per skill) for Claude Code to read .agents/skills/
.claude/settings.json # Claude Code permissions: deny reading .env files (see SECURITY.md)
```

## Dev Container

The environment is defined entirely in
[`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json). It starts from a prebuilt
base image and layers Dev Container Features and VS Code extensions on top; no Dockerfile or
Compose file is required. Customise the environment by adding Features, switching the base image,
or adding extensions. Features are pinned by major tag and resolved in the committed
`devcontainer-lock.json`. Extensions are listed by identifier only, because a published extension
version cannot be repointed and a version suffix is VS Code-specific.

### Host container management

The Dev Container deliberately has **no access to the host Docker daemon**: the socket is not
mounted ([ADR-0004](docs/adr/0004-dev-container-runtime.md)). To manage the host's containers from
VS Code, run the **Container Tools** extension (`ms-azuretools.vscode-containers`) on the **host**
side: install it in your host VS Code. [`.vscode/settings.json`](.vscode/settings.json) already pins
it to run locally via `remote.extensionKind`, so it keeps talking to the host engine even when this
folder is reopened in the container.

## Coding Agents

This Dev Container preinstalls the **Claude Code** and **Mistral Vibe** VS Code extensions (see
[`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json)); other agents (OpenAI Codex,
Cursor, OpenCode, GitHub Copilot) work too once you add them.

The rules every agent follows live in [`AGENTS.md`](AGENTS.md); that there is exactly one such file
is decided in [ADR-0001](docs/adr/0001-agent-governance-model.md). An agent that cannot read it
natively gets a pointer file instead. [`.claude/CLAUDE.md`](.claude/CLAUDE.md) is the one shipped
here; it carries the pointer and no rules of its own ([`AGENTS.md` §3](AGENTS.md#3-adr-rules)). It
exists for one gap only: Claude Code loads `CLAUDE.md`, not `AGENTS.md`, tracked upstream as
[anthropics/claude-code#34235](https://github.com/anthropics/claude-code/issues/34235). Once that
lands, delete the pointer file rather than keeping a second file to maintain.

The procedures those rules name (proposing an ADR, planning a feature, working its tickets
alone or in parallel, reviewing a change, revising the design, normalizing the record) are Agent
Skills under [`.agents/skills/`](.agents/skills/), the open format and the directory Codex,
Gemini CLI, and Cursor read
([ADR-0003](docs/adr/0003-procedures-as-skills.md)). An agent invokes one by name (`/review`) or
picks it up when the task matches its description. Claude Code reads `.claude/skills/` only, so
that directory holds one symlink per skill into `.agents/skills/`; a directory-level symlink is
not followed. The symlinks are pointers of the same kind as `CLAUDE.md`, tracked upstream as
[anthropics/claude-code#31005](https://github.com/anthropics/claude-code/issues/31005). Delete them
when that lands, and add one for every skill added meanwhile; the documentation check fails on a
skill without its pointer. A rule is enforced only by what every agent hits: the git hooks under
[`.githooks/`](.githooks/), the checks, and the repository settings below. A tool's own
configuration is not used to enforce one, because a gate that one agent honours and the next does
not looks like a rule and is not one.

Agents work tickets in parallel without any one vendor's mechanism: a dispatching session claims
each ticket by its branch in a git worktree of its own and starts a fresh session there, with the
non-interactive command of whichever agent the project's harness ADR names, and the session works
the ticket through the `work-tickets` skill.

## Repository settings

Some of this project's rules cannot be enforced by files in the repository
([`AGENTS.md` §6](AGENTS.md#6-project-rules)). They are settings on the GitHub repository itself,
configured once by a maintainer and worth re-checking after a repository move or transfer:

- a **ruleset on `main`** that requires pull requests, requires the
  <!-- required-checks begin — compared with the workflow's jobs by scripts/check-docs.sh -->
  `docs`, `traceability`, `devcontainer`, `sensors`, `shell`, and `code`
  <!-- required-checks end -->
  jobs of the **Checks** workflow as required status checks (rulesets list checks by their job
  name) and a branch up to date with `main` before it merges, so that the checks see what the
  merge produces, such as two ADRs proposed in parallel under one number, and blocks force
  pushes and branch deletion;
- enable **require a review from Code Owners** on that ruleset, so the two artifacts only a human
  decides, [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) and everything under
  [`docs/adr/`](docs/adr/) ([`AGENTS.md` §3](AGENTS.md#3-adr-rules)), and the protected parts of
  [ADR-0007](docs/adr/0007-harness.md) cannot be merged without the owner named in
  [`.github/CODEOWNERS`](.github/CODEOWNERS), which has to carry a real handle or team for the
  requirement to mean anything;
- enable **secret scanning with push protection**, the only mechanical backstop behind the secrets
  rule ([`AGENTS.md` §7](AGENTS.md#7-secrets)), which is otherwise carried by review alone;
- enable **private vulnerability reporting** (see [`SECURITY.md`](SECURITY.md)).

## Template

- **Template release:** v0.2.0 — the release of [NUC](https://github.com/hivevm/nuc) this
  repository carries; a project moves the line when it takes up a later one
  ([ADR-0005](docs/adr/0005-template-releases.md)).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow (specification- and ADR-driven, small
reviewable changes) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for the community standards we
expect of everyone taking part. Security issues: please follow [`SECURITY.md`](SECURITY.md) instead
of opening a public issue.

## License

Released under the MIT License. See [`LICENSE`](LICENSE).
