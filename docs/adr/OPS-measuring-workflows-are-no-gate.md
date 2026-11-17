# OPS-measuring-workflows-are-no-gate: A workflow that measures what the local gate cannot is no gate, and a script a listed one runs counts where that one runs

- **Status:** 🟢 accepted
- **Date:** 2026-11-17
- **Deciders:** Markus Brigl
- **Applies to:** the `# Not a gate:` and `# On instruction:` lines of `scripts/check-all.sh`, the rule `docs/check-lists` of `scripts/check-docs.sh` and its cases in `scripts/fixtures/check-docs-record.txt`, `.github/workflows/benchmark.yml`, `.github/workflows/mutation.yml`, `.github/workflows/devcontainer.yml`
- **Extends:** NUC-checks-are-bash §5, NUC-checks-are-bash §7

## Context

[NUC-checks-are-bash §5](NUC-checks-are-bash.md) names one kind of workflow that is no gate: one
that publishes rather than checks. Comb runs three workflows that check what no push could run:
the build of the Dev Container (`devcontainer.yml`), the benchmark on a runner
(`benchmark.yml`, Q-1 and Q-2), and a mutation run of about an hour (`mutation.yml`). Each is a
measurement or a check the local gate cannot make. Under the base clause alone, each would have to
be a required check, which a push cannot satisfy, or run no script the lists count.

Comb also builds before it checks what the build wrote. A script that `scripts/check-all.sh` runs
calls another one by a line `bash scripts/<name>.sh`, so the inner one runs after the build, in the
same job. Under the base clause the inner script stands in neither list and fails the rule
`docs/check-lists` as a script nobody runs.

[NUC-checks-are-bash §7](NUC-checks-are-bash.md) names three kinds of script that run only on a
human's instruction. A script that reads what a workflow named as no gate alone produces, such as
`scripts/check-mutants.sh` on the output of the mutation run, is none of them.

Until the take-up of NUC v0.9.1 these two rules stood in the inherited ADR-0002, which Comb had
extended in place. The base is fixed now
([NUC-base-is-fixed §1](NUC-base-is-fixed.md)), so they stand in an ADR of Comb's own.

## Decision

We will treat a workflow that checks what the local gate cannot as no gate, and count a script
where the script that runs it runs.

1. **No gate.** A workflow that checks or measures what the local gate cannot is no gate, like one
   that publishes. Examples are a build of the container, a measurement on a runner, and a
   mutation run of an hour. `scripts/check-all.sh` names it on a `# Not a gate:` line.
2. **On instruction.** A script that only workflows named as no gate run may stand on an
   `# On instruction:` line of `scripts/check-all.sh` instead of a run line. Such a script is a
   fourth kind beside the three of NUC-checks-are-bash §7. An example is a script that reads what
   such a workflow alone produces. A script that a gating workflow runs too must stand on a run
   line.
3. **Nested scripts.** A listed script may run another one by a line `bash scripts/<name>.sh` or
   `bash "$ROOT/scripts/<name>.sh"` of its own. The other script then runs where the listed one
   runs, in the same lists, to any depth. A check that reads what a build wrote runs after the
   build, inside the build's script. A line that only mentions a script, such as a comment, runs
   nothing.

**Out of scope:** which workflows Comb runs, which
[DEV-bun-vite-and-wasm-pack](DEV-bun-vite-and-wasm-pack.md) and the ADRs of each measurement decide.

## Alternatives considered

- **Every workflow a gate** — the benchmark and the mutation run would be required checks that no
  push can meet, and every pull request would wait an hour on one.
- **The measuring workflows run no script of `scripts/`** — their commands inline, so the rule
  `docs/check-lists` has nothing to count. Then the local runner cannot run the same steps by hand,
  and the steps drift apart.
- **The nested scripts on run lines of their own** — the inner check would run beside the build,
  before what it reads exists, and fail on every clean tree.

## Sources / Prior art

- [NUC-checks-are-bash §5](NUC-checks-are-bash.md) and
  [NUC-checks-are-bash §7](NUC-checks-are-bash.md), the clauses this ADR extends.
- The inherited ADR-0002 at NUC v0.7.0, extended in place by Comb, whose added clause this ADR
  restates.

## Consequences

- Positive: the benchmark, the mutation run, and the build of the container run in CI without
  blocking a pull request, and the lists still name every script they run.
- Negative / trade-offs: a workflow named as no gate can go red without stopping a merge, so its
  results need a reader. A script on an `# On instruction:` line runs only when someone asks.
- Follow-ups: none.

## Enforcement

The rule `docs/check-lists` of [`scripts/check-docs.sh`](../../scripts/check-docs.sh) holds the
three clauses. Its cases stand in
[`scripts/fixtures/check-docs-record.txt`](../../scripts/fixtures/check-docs-record.txt) under the
comment that names this ADR, and [`scripts/test-check-docs.sh`](../../scripts/test-check-docs.sh)
runs them ([NUC-decisions-cite-tests](NUC-decisions-cite-tests.md)).

**Not mechanically decidable:** that a workflow named as no gate does check what the local gate
cannot, which the review of the change that names it judges.
