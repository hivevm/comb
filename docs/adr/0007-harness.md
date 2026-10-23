# ADR-0007: One agent implements, a fresh session reviews, and the protected parts stay with the maintainer

- **Status:** 🟡 proposed
- **Date:** 2026-10-17
- **Deciders:** Markus Brigl
- **Applies to:** every change and every agent session in this repository, `docs/adr/`, `docs/SPECIFICATION.md`, `.github/CODEOWNERS`, and the tickets under `docs/plan/`

## Context

Comb has one maintainer who works with coding agents, without a fixed deadline
([Constraints](../SPECIFICATION.md#constraints)). The work spans many sessions, so the harness has
to say who implements, who reviews, and what runs without the maintainer
([`AGENTS.md` §4](../../AGENTS.md#4-working-style)). The catalogue offers three forms that grow
into each other: one agent whose every change the human reviews, implementer and reviewer apart,
and parallel tickets under a cap.

With one maintainer, review is the bottleneck. Having the maintainer read every change makes
them the limit on all progress; parallel tickets produce more pull requests than one person
reads. Implementer and reviewer apart lets a fresh session catch what the implementing session
missed, and keeps the maintainer's reading for the parts where a mistake is costly.

Those parts follow from the specification. Comb is a framework for others' applications
([Q-3](../SPECIFICATION.md#quality-goals)), so its public TypeScript interface is a promise to
every host application. The data format of the bridge decides Q-1. The validation of graph data
holds the forbidden actions Q-5 to Q-7. The CI workflows are the build pipeline the threats name
as an asset ([Threats](../SPECIFICATION.md#threats--forbidden-actions)).

## Decision

We will have one agent, Claude Opus (`claude-opus-5-5`), implement each change in a session of
its own, and a fresh session of the same model review it with the `review` skill before its pull
request opens, with Markus Brigl as the one maintainer who decides ADRs and the specification,
reviews every change to the protected parts, and caps open agent work at two.

- **Starting a session without a human:** `claude -p "<prompt>" --model claude-opus-5-5`, for the
  implementing and the reviewing session alike, run where the `claude` command is installed. The
  Dev Container does not install it; inside the container, the agent runs from the VS Code
  extension.
- **Protected parts,** never worked unattended however small the ticket, and reviewed by the
  maintainer as well as by the reviewing session: the public TypeScript interface of Comb
  (`packages/comb/src/index.ts`, `packages/comb/src/api/`, the exports of
  `packages/comb/package.json`); the data format of the bridge and the validation of graph data
  that holds Q-5 to Q-7 (`crates/engine-wasm/`, `packages/comb/src/bridge/`); the mesh budget
  that holds Q-7 for accepted graph data (`crates/engine/src/stroke.rs`,
  `crates/engine/src/graph.rs`); and the CI and the checks the ADRs rest on (`.github/`,
  `scripts/check-*.sh`, `scripts/sensor-*.sh`). `.github/CODEOWNERS` names these paths.
- **Unattended work:** a ticket whose *Mode* allows it and that touches no protected part may be
  implemented and reviewed without the maintainer; its pull request still waits for the
  maintainer to merge.
- **Cap:** at most two pieces of agent work are open at once, counting tickets in progress and
  pull requests awaiting the maintainer. Sessions run one after another; no two implement at the
  same time.
- **Decider:** Markus Brigl is the only decider of ADRs and the code owner of `docs/adr/` and
  `docs/SPECIFICATION.md`.

**Out of scope:** parallel tickets in worktrees, which a later ADR takes up when the cap holds
back work the maintainer could review; a second maintainer; which tools the review uses beyond
the `review` skill.

## Alternatives considered

- **One agent, the maintainer reviews every change** — the simplest form, but every change waits
  on one person, and a fresh-context review catches mistakes before they reach the maintainer at
  no cost to them.
- **Parallel tickets under a cap** — more throughput than one maintainer can review today; the
  catalogue lets the harness grow into it once the review keeps up.
- **A stronger or different model as reviewer** — the catalogue suggests a stronger model where
  one exists; Claude Opus is the strongest available, so implementer and reviewer share it, and
  the fresh context provides the independence.
- **No model named** — vendor-neutral, but then no command starts a session without a human, which
  the harness has to name.

## Sources / Prior art

- The *Harness* entry of the `propose-adr` concept catalogue, with its sources:
  Birgitta Böckeler, *Harness engineering* —
  <https://martinfowler.com/articles/harness-engineering.html>; Addy Osmani, *Agentic autonomy
  levels* — <https://addyosmani.com/blog/agentic-autonomy-levels/>.

## Consequences

- Positive: the maintainer reads the parts where a mistake reaches host applications, and a
  fresh session reads everything else first.
- Positive: two open pieces of work fit one maintainer's review.
- Negative / trade-offs: no parallel implementation, so throughput is one session at a time.
- Negative / trade-offs: implementer and reviewer share one model and may share its blind spots;
  the maintainer's review of the protected parts is the counterweight.
- Follow-ups: growing into parallel tickets when the cap holds back reviewable work.

## Enforcement

**Not mechanically decidable:** who reviews, who decides, and what runs unattended are decided
outside the tree. What the harness relies on mechanically is already checked: the git hooks under
`.githooks/`, the required checks, and the Code Owners review of the repository settings listed in
the README.
