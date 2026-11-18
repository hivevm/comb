# DEV-tickets-integrate-on-feat-branch: The tickets of a spec the human assigns to a `feat/` branch are claimed and worked there, one after another, their blockers closed on that branch

- **Status:** 🟢 accepted
- **Date:** 2026-11-18
- **Deciders:** Markus Brigl
- **Applies to:** the frontier and the claim of a ticket whose spec the human assigned to a `feat/` branch, its ticket branch, and its integration on that branch
- **Extends:** NUC-large-work-is-planned §4

## Context

[NUC-large-work-is-planned §4](NUC-large-work-is-planned.md) makes the frontier the open tickets on
`main` whose blockers are closed, and the claim the branch `ticket/<spec>/<NN>-<slug>`. The
`work-tickets` skill creates that branch at `main`, and a ticket's blocker closes when the branch
that deletes its file reaches `main`.

[NUC-main-only-via-pr §5](NUC-main-only-via-pr.md) lets reviewed branches integrate first on a
`feat/` branch, which reaches `main` by one pull request. The steps stand under *Integration
branches* in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

The two do not meet for a spec whose tickets build on each other. The human decided on 2026-11-18
to land the fourteen tickets of `docs/plan/uml-diagrams/` one after another on
`feat/uml-diagrams`, by a single pull request. Its first ticket is integrated there. On `main` its
file stays until that pull request merges, so every later ticket stays blocked there. A ticket
branch created at `main` would also lack the code its blockers added.

Without a decision, every ticket after the first would be worked against
[NUC-large-work-is-planned §4](NUC-large-work-is-planned.md), and a reader without this
conversation would take that for a mistake. The alternatives are a pull request per ticket, which
the human declined, or a fork of the template, which nothing here needs: the frontier on
`main` stays as it is, and this ADR adds a second one for the work that integrates on a `feat/`
branch.

The frontier sensor [`scripts/sensor-plan-frontier.sh`](../../scripts/sensor-plan-frontier.sh) and
the claim script of the `work-tickets` skill belong to the template. The sensor takes `--root`, the
checkout whose `docs/plan/` it reads, and reads the claims from the branches of the repository.
Run on a checkout of the `feat/` branch, it lists that branch's frontier unchanged.

This ADR serves no goal of [`docs/SPECIFICATION.md`](../SPECIFICATION.md) directly. It decides how
the work on G-14 to G-20 is planned and integrated.

## Decision

We will let the human assign a spec to a `feat/` branch, whose tickets are then claimed, worked,
and integrated on that branch, one after another.

1. **Assignment.** A spec is assigned to a `feat/` branch only on the human's instruction. The
   instruction names the spec and the branch.
2. **Frontier.** A ticket of an assigned spec is on the frontier of its `feat/` branch under three
   conditions:
   - its file lies on that branch;
   - the files of its blockers do not;
   - no session claims it.
3. **Claim.** The claim stays the branch `ticket/<spec>/<NN>-<slug>`. The agent must create it at
   the head of the `feat/` branch, by `git branch ticket/<spec>/<NN>-<slug> feat/<topic>`. It must
   not use the claim script of the `work-tickets` skill, which creates the branch at `main`. The
   local branch holds the claim, as the claim script's does without a remote.
4. **Order.** The agent must work the tickets of an assigned spec one after another. It must start
   the next one only once the last one is integrated.
5. **Integration.** A ticket branch integrates by the steps of *Integration branches* in
   `CONTRIBUTING.md`, after its review
   ([NUC-main-only-via-pr §5](NUC-main-only-via-pr.md)). Its blocker closes on the `feat/` branch
   when that branch integrates it, since the ticket branch deleted its file
   ([NUC-large-work-is-planned §5](NUC-large-work-is-planned.md)).

**Out of scope:**

- tickets of one spec worked in parallel on its `feat/` branch, which the harness ADR
  ([DEV-implementer-and-fresh-reviewer](DEV-implementer-and-fresh-reviewer.md)) leaves out of
  scope;
- the release of a ticket branch, which the `work-tickets` skill and
  [NUC-main-only-via-pr §2](NUC-main-only-via-pr.md) decide;
- changes to the template's sensor and claim script, which a finding to the template may propose.

## Latitude

None.

## Alternatives considered

- **A pull request into `main` per ticket** — every blocker closes on `main` as
  [NUC-large-work-is-planned §4](NUC-large-work-is-planned.md) expects, but the
  human chose one pull request for the spec, so that `main` gains the UML diagrams whole.
- **Stacked pull requests, each based on the one before** — each ticket gets its pull request, but
  every merge retargets the next, and the human still reviews fourteen times instead of once.
- **One ticket for the whole spec** — no blocker remains, but a ticket larger than one session
  breaks [NUC-large-work-is-planned §1](NUC-large-work-is-planned.md).
- **Changing the template's sensor and claim script to take a base branch** — the frontier would be
  decided mechanically, but the project would diverge from the template's files and collide with
  the next take-up of a release.
- **Working against the clause by the human's instruction alone, without an ADR** — no record,
  and the next session would correct it.

## Sources / Prior art

- [NUC-large-work-is-planned §1](NUC-large-work-is-planned.md),
  [NUC-large-work-is-planned §4](NUC-large-work-is-planned.md), and
  [NUC-large-work-is-planned §5](NUC-large-work-is-planned.md).
- [NUC-main-only-via-pr §2](NUC-main-only-via-pr.md) and
  [NUC-main-only-via-pr §5](NUC-main-only-via-pr.md).
- *Integration branches* in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- The `work-tickets` skill and its claim script, and the `--root` option of
  `scripts/sensor-plan-frontier.sh`.

## Consequences

- Positive: a spec whose tickets build on each other reaches `main` whole, by one pull request and
  one review of the whole branch.
- Positive: the frontier on `main` and the claims stay as the template keeps them.
- Negative: `main` lists the tickets of an assigned spec as open until its `feat/` branch merges.
  The sensor run on `main` shows them blocked or on the frontier there, and their claims keep them
  from being claimed twice.
- Negative: the `feat/` branch carries every ticket's work until its pull request, so its rebuild by
  topic and its whole-branch review grow with the spec.
- Follow-ups: whether the template's sensor and claim script take a base branch, as a finding to
  the template; parallel tickets on one `feat/` branch, once the cap allows them.

## Enforcement

**Not mechanically decidable:** no check knows which spec the human assigned to which branch. The
frontier of a `feat/` branch is the unchanged frontier sensor, run with `--root` on a checkout of
that branch. The claim is the `git branch` of
[DEV-tickets-integrate-on-feat-branch §3](DEV-tickets-integrate-on-feat-branch.md). Review holds
that a ticket branch of an assigned spec starts at the head of its `feat/` branch, and that each
integration passed its review first.
