# Comb

[![Checks](https://github.com/hivevm/comb/actions/workflows/checks.yml/badge.svg)](https://github.com/hivevm/comb/actions/workflows/checks.yml)

**Comb** is a high-performance, interactive node-editor framework for the browser, built to stay
responsive with tens of thousands of nodes. The work is driven by a written **specification**
([`docs/SPECIFICATION.md`](docs/SPECIFICATION.md)) and **Architecture Decision Records**
([`docs/adr/`](docs/adr/)), so intent and the reasoning behind every structural choice stay
explicit and reviewable.

> For agent instructions, see [`AGENTS.md`](AGENTS.md), the single source of truth for all coding
> agents.

> [!NOTE]
> **This project still carries its template setup.** The one-time steps that turn the scaffold
> into your own project are in [`TEMPLATE-SETUP.md`](TEMPLATE-SETUP.md); ask your agent to run the
> `setup-project` skill to be walked through them, one question at a time. Delete that file and
> this note once you are through them.

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

> Setting the project up for the first time? The one-time steps are in
> [`TEMPLATE-SETUP.md`](TEMPLATE-SETUP.md). Delete this paragraph together with that file.

1. Open the repository in VS Code and choose **Reopen in Container**. The Dev Container and the
   preconfigured agent extensions build automatically, and the container enables the repository's
   git hooks ([`.githooks/`](.githooks/)): no commit on `main`, and the checks run before a push.
   Working outside the container? Enable them yourself, once per clone:
   `git config core.hooksPath .githooks`.
2. Authenticate your coding agent inside the container (for Claude Code: `claude login`).
3. Start working with the agent. Drive the work from the specification and the ADRs.

## Build, Test & Run

Inside the Dev Container, which provides Bun, Rust, wasm-pack, and Chromium
([ADR-0008](docs/adr/0008-toolchain.md), [ADR-0014](docs/adr/0014-dev-container-toolchain.md)).
[`scripts/check-code.sh`](scripts/check-code.sh) runs the first three in order, then the
structural test of [ADR-0009](docs/adr/0009-functional-core-imperative-shell.md) and the bundle
budget of Q-3 (`bun run build:lib`, at most 300 kB gzipped without PixiJS).

- **Build:** `bun run build` — the engine with wasm-pack, the type check, and the example
- **Test:** `bun run test` — `cargo test`, `bun test`, and the Playwright browser tests
- **Lint:** `bun run lint` — rustfmt, clippy, ESLint, and Prettier
- **Run:** `bun run example`, or the launch configuration **Example: metric tree** in VS Code,
  which opens the example in the host's browser; `?copies=3334` opens it with 50,010 nodes
- **Benchmark:** `bun run bench` — the example at 50,010 nodes and edges in Chromium: time to the
  first frame and p95 frame times of drag, pan, and zoom against Q-1 and Q-2, written to
  `bench-results/latest.json`. `BENCH_HEADED=1` opens a window that uses the machine's GPU, which
  is how the numbers on the reference machine are taken; `BENCH_COPIES` sets another size.
  The **Benchmark** workflow runs it three times on a GitHub runner, weekly and on demand
  (*Actions* → *Benchmark* → *Run workflow*), and fails when the median of a number exceeds
  `bench/baseline.json` by more than 25 %, naming it; the runs and their median are uploaded as the
  artefact `bench-results` (`bun bench/compare.ts bench/baseline.json <run>...` compares locally).
  To update the baseline, take `median.json` from the artefact of a run on `main`, save it as
  `bench/baseline.json`, and open a pull request that says why the numbers moved; a runner's
  numbers are compared only with a runner's.

## Usage

<!-- Once there is something to use, show how to use the built software: the primary commands or
     API, a minimal example, and the expected output. Keep build/test/run mechanics in the section
     above; this section is about using the result, not producing it. -->

A host application gives Comb an element to fill, hands it the graph, and keeps the forms:

```ts
import { createComb } from "comb";

const comb = await createComb(document.getElementById("canvas")!);
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
```

[`examples/metric-tree/`](examples/metric-tree/) is a complete host application with a sidebar.

## Project Layout

```
TEMPLATE-SETUP.md     # one-time template setup; delete it when the project is yours
README.md             # overview & setup for humans
AGENTS.md             # single source of truth for coding agents
docs/SPECIFICATION.md # the specification: problem, goals, success criteria
docs/GLOSSARY.md      # the vocabulary everyone uses, kept current inline
docs/CONVENTIONS.md   # how this project writes what no check decides, kept current inline
docs/ARCHITECTURE.md  # the system as it currently stands
docs/adr/             # Architecture Decision Records (+ template)
crates/engine/        # the engine's pure Rust core: geometry over values and buffers (ADR-0009)
crates/engine-wasm/   # the bridge's Rust side: every WebAssembly export (ADR-0010)
packages/comb/        # the library: api, store, interaction, render, bridge
examples/metric-tree/ # the example host application, with its browser tests (G-9)
scripts/              # consistency checks and sensors (check-all.sh runs them all), run in CI
.githooks/            # git hooks: refuse a commit on main and a push while the checks are red
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
  [`docs/adr/`](docs/adr/) ([`AGENTS.md` §3](AGENTS.md#3-adr-rules)), cannot be merged without the
  owner named in [`.github/CODEOWNERS`](.github/CODEOWNERS), which has to carry a real handle or
  team for the requirement to mean anything;
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
