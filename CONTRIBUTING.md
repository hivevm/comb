# Contributing

Thanks for your interest in contributing. This project is **specification- and ADR-driven**. The
working rules in [`AGENTS.md`](AGENTS.md) are the single source of truth, and they govern coding
agents and human contributors alike. This file carries no rules of its own: it points at them and
adds only the contributor-facing procedure and the mechanics the rule file delegates to it: what
the git hooks refuse, the steps of an integration branch, and the repository settings.

## Before you start

Read what [`AGENTS.md` §2](AGENTS.md#2-start-here) names before any non-trivial work, then
[`AGENTS.md`](AGENTS.md) itself, the working rules for humans and agents alike, and
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md), how this project writes code and tests where no
check decides it.

Authority runs **specification → accepted ADRs → task**
([`AGENTS.md` §3](AGENTS.md#3-adr-rules)).

## Workflow

1. **Settle scope and intent first** when they are not yet agreed
   ([`AGENTS.md` §4](AGENTS.md#4-working-style)).
2. **Follow [`AGENTS.md`](AGENTS.md)**: when a decision needs an ADR and how it is reviewed
   ([§3](AGENTS.md#3-adr-rules)), when a change counts as done
   ([§5](AGENTS.md#5-quality-bar--definition-of-done)), and the git and project rules
   ([§6](AGENTS.md#6-project-rules)). Run [`scripts/check-all.sh`](scripts/check-all.sh) locally
   before pushing ([§5](AGENTS.md#5-quality-bar--definition-of-done)). It runs the same checks CI
   runs on every pull request, and the repository's git hooks run them for you
   ([Git hooks](#git-hooks)). They need bash 4.4 or later and coreutils,
   already in the Dev Container.
   Only the shell lint additionally needs [ShellCheck](https://www.shellcheck.net), which the Dev
   Container installs; elsewhere it skips itself where that is missing, and CI runs it always.
3. **Open a pull request** against `main` and fill in the PR template.

## Project Layout

```
README.md             # overview & setup for those who use the project
AGENTS.md             # single source of truth for coding agents
CONTRIBUTING.md       # how to work on the project: this file, pointing at the rules
SECURITY.md           # how to report a vulnerability, and what the configuration guarantees
CODE_OF_CONDUCT.md    # the standards everyone taking part is held to
LICENSE               # the license the project is released under
docs/SPECIFICATION.md # the specification: problem, goals, success criteria
docs/GLOSSARY.md      # the vocabulary everyone uses, kept current inline
docs/CONVENTIONS.md   # how this project writes what no check decides, kept current inline
docs/ARCHITECTURE.md  # the system as it currently stands
docs/adr/             # Architecture Decision Records (+ template)
crates/engine/        # the engine's pure Rust core: geometry over values and buffers (ADR-0009)
crates/engine-wasm/   # the bridge's Rust side: every WebAssembly export (ADR-0010)
packages/comb/        # the library: api, store, interaction, render, bridge
examples/metric-tree/ # the example host application, with its browser tests (G-9)
bench/                # the benchmark: the example in Chromium against Q-1 and Q-2, and the baselines
Cargo.toml            # the Rust workspace of the two crates; Cargo.lock pins its dependencies
Cargo.lock
clippy.toml           # the project's Clippy settings, the methods it refuses among them
package.json          # the Bun workspace and its scripts; bun.lock pins its dependencies
bun.lock
tsconfig.json         # the TypeScript settings every package extends
eslint.config.js      # ESLint's rules
.prettierrc.json      # Prettier's settings, and .prettierignore what it leaves out
.prettierignore
playwright.config.ts  # the browser tests: Chromium, the example's server, the test directory
docs/plan/            # open work: feature specs and their tickets, deleted as they land
scripts/check-all.sh  # runs the checks, sensors, and self-tests, as the hooks and CI do
scripts/check-*.sh    # checks: each fails on what breaks a rule
scripts/sensor-*.sh   # sensors: report for the reviewer; sensor-repo-settings.sh runs by hand
scripts/test-*.sh     # self-tests of the checks, the sensors, the hooks, and the scripts run by
                      # hand
scripts/lib/          # what the scripts share: the ADR header, git, the ticket path, the self-tests
scripts/*.sh          # run by hand, steps 7 and 8 of the integration branches: number-adrs.sh,
                      # ready-for-main.sh, drop-merged-branch.sh
.githooks/            # git hooks: nothing lands on main locally; the documentation checks before
                      # a commit staging Markdown; checks before a merge and a push
.github/workflows/    # checks.yml runs the checks; review-binding.yml reads each pull request's hand-off
.github/              # Dependabot, issue & pull request templates, code owners
.devcontainer/        # Dev Container definition (Dockerfile + Features)
.vscode/              # shared editor settings
.editorconfig         # editor-neutral formatting baseline
.gitattributes        # line-ending normalization (LF everywhere), the ADR index merged by its driver
.gitignore            # what git leaves out, .scratch/ for session artifacts among it
.agents/skills/       # the procedures of AGENTS.md as Agent Skills, one directory each (ADR-0003),
                      # with the scripts and templates they carry (claim.sh, remap.sh, ticket.md)
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

The container allows 8192 tasks, threads included (`--pids-limit=8192` in `runArgs`), in place of
Podman's default of 2048, so that two worktrees can run `CI=1 scripts/check-all.sh` at once: one
run peaks at about 1400, most of it Chromium under Playwright. A changed limit takes effect only
once the container is rebuilt; `cat /sys/fs/cgroup/pids.max` inside it shows the limit in force.

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
skill without its pointer. What enforces a rule is what every agent hits
([`AGENTS.md` §6](AGENTS.md#6-project-rules)): the git hooks under [`.githooks/`](.githooks/),
the checks, and the repository settings below.

Agents work tickets in parallel without any one vendor's mechanism: a dispatching session claims
each ticket by its branch in a git worktree of its own and starts a fresh session there, with the
non-interactive command of whichever agent the project's harness ADR names, and the session works
the ticket through the `work-tickets` skill.

## Git hooks

Git does not version its hooks, so the repository keeps them under [`.githooks/`](.githooks/).
They hold for every agent and every human. The Dev Container enables them, with the merge
settings they rely on, on every start; outside it, run once per clone:

```sh
git config core.hooksPath .githooks
git config merge.ff false
git config pull.ff only
git config merge.adr-index.driver '.githooks/merge-adr-index %O %A %B %S %X %Y'
```

`merge.ff false` makes every merge a merge commit, as a `feat/` branch keeps them
([`AGENTS.md` §6](AGENTS.md#6-project-rules)); a fast-forward would make no commit and run no
hook. `pull.ff only` keeps a pull from then making a merge. Without the two settings the hooks
still hold: a fast-forward skips the documentation check of `pre-merge-commit`, and the push
still gates what it brought. The merge driver of the ADR index keeps the rows both sides add and
stops on its prose ([`.githooks/merge-adr-index`](.githooks/merge-adr-index)); without it, every
row two branches append conflicts.

| Hook | Refuses | Bypassed by |
|---|---|---|
| `reference-transaction` | moving the local `main` to a commit `origin/main` lacks: by a commit, merge, cherry-pick, reset, or `git branch -f`. It lets through `git merge --ff-only origin/main`, a reset to it, `git fetch origin main:main`, a write of `main` where it already is, and a deletion. Needs git 2.28 or later. | running git without the hooks (`git -c core.hooksPath=/dev/null`), or moving `origin/main` by hand; not by `--no-verify` |
| `pre-commit` | a commit on `main`; the conclusion of a conflicted merge while `scripts/check-all.sh --changed` is red; any other commit that stages a Markdown file while `scripts/check-docs.sh` is red or missing | `--no-verify` |
| `pre-merge-commit` | a merge on `main`; a merge into any other branch while `scripts/check-docs.sh` is red | `--no-verify` |
| `pre-push` | a push to the remote's `main`, a deletion included; any other push while `scripts/check-all.sh --changed` is red, except one that only deletes, and one from a clean working tree whose tree the checks passed on before, as after a rework that only regroups | `--no-verify`, as the claim on a ticket does ([`AGENTS.md` §6](AGENTS.md#6-project-rules)); a tree written by hand into `checks-green-trees` of the git directory |

With `--changed`, the self-tests of what the branch left untouched since `main` are skipped; CI
runs every one before anything reaches `main`. A bypass is a deliberate act, not a default;
[`AGENTS.md` §6](AGENTS.md#6-project-rules) says when an agent may. Each refusal says what to do
instead.
[`scripts/test-git-hooks.sh`](scripts/test-git-hooks.sh) exercises every row.

## Integration branches

A change reaches `main` through a pull request. Several branches may integrate first on a
`feat/` branch, by local merges or by pull requests against it, and it stays the human's to
rework until its pull request into `main` merges ([`AGENTS.md` §6](AGENTS.md#6-project-rules)).
Each step waits for a human's instruction.

1. Start it at the remote's `main`: `git fetch origin`, then
   `git switch -c feat/<topic> origin/main`.
2. Run the checks on each commit a reviewed branch adds:
   [`scripts/check-commits.sh`](scripts/check-commits.sh) `feat/<topic> <branch>` checks out each
   in a temporary worktree, runs the checks that need no browser, and names every commit and
   check that fails. Then merge the branch into it with its hand-off as the message, written to a
   file since an editor strips its headings:
   `git merge --no-ff -F .scratch/<hand-off>.md <branch>`. The documentation check gates the
   merge, and the push of step 6 runs the rest. One that stops on a conflict is concluded, once
   resolved and staged, with `git commit -F .scratch/<hand-off>.md`, and all the checks gate that
   commit.
3. Or, after the same run, merge it by a pull request against the `feat/` branch, so that its
   pipelines run what the local gate cannot, such as another platform or a service
   ([`AGENTS.md` §6](AGENTS.md#6-project-rules)). With both branches pushed, on the branch:
   `gh pr create --base feat/<topic> --body-file .scratch/<hand-off>.md`, and once it is green,
   `gh pr merge <number> --merge --body-file .scratch/<hand-off>.md`, never by the web interface,
   whose merge commit drops the hand-off. Then, on the `feat/` branch, `git fetch origin` and
   `git merge --ff-only origin/feat/<topic>`.
4. Rework it as often as needed: rebase it, regroup its commits, or drop what did not hold,
   with `git rebase -i --autosquash --rebase-merges`. `--autosquash` folds in the fixups a review
   leaves, as the `review` skill says; without `--rebase-merges` the merges flatten, and their
   hand-offs with them. A pull request still open against the `feat/` branch is rebased onto the
   rework.
5. After a rework, review the whole branch at its head
   ([`AGENTS.md` §5](AGENTS.md#5-quality-bar--definition-of-done)) and name that commit on the
   `Reviewed at:` line of the pull request of step 6, which
   [`review-binding.yml`](.github/workflows/review-binding.yml) reads on every push and edit.
6. Test it in the pipelines: `git push -u origin feat/<topic>`, then open a draft pull request,
   `gh pr create --draft --base main`, which runs them on every push against what the merge
   into `main` would produce. A branch kept without a pull request, such as an experiment, runs
   them by hand: `gh workflow run checks.yml --ref feat/<topic>`. A rework already pushed goes out
   with `git push --force-with-lease`.
7. Make the pull request ready: [`scripts/ready-for-main.sh`](scripts/ready-for-main.sh) refuses
   a fixup steps 4 to 6 left, takes up the remote's `main`, and numbers the draft ADRs
   ([ADR-0002](docs/adr/0002-decisions-verified-by-tests.md)); then the push it names and
   `gh pr ready`. What `main` gains later is taken up the same way, and an ADR it gains moves the
   branch's numbers on ([mechanics](docs/adr/README.md#mechanics)).
8. Once the pull request into `main` has merged as a merge commit, take it up and drop the branch:
   on it, [`scripts/drop-merged-branch.sh`](scripts/drop-merged-branch.sh) refuses a branch
   `origin/main` lacks, takes up the remote's `main`, and deletes the local branch; then the
   `git push origin --delete feat/<topic>` it names.

## Repository settings

Some of this project's rules cannot be enforced by files in the repository
([`AGENTS.md` §6](AGENTS.md#6-project-rules)). They are settings on the GitHub repository itself,
configured once by a maintainer and worth re-checking after a repository move or transfer:

- a **ruleset on `main`** that requires pull requests and allows the merge method **merge commit**
  only, since squash and rebase discard the merges a `feat/` branch carries and the commits it
  was reworked into ([`AGENTS.md` §6](AGENTS.md#6-project-rules)); requires the
  <!-- required-checks begin — compared with the workflow's jobs by scripts/check-docs.sh -->
  `docs`, `traceability`, `devcontainer`, `sensors`, `shell`, and `code`
  <!-- required-checks end -->
  jobs of the **Checks** workflow as required status checks (rulesets list checks as they report:
  a job by its name, a job with a matrix by one check run per entry, such as
  `build (ubuntu-latest)`, which this list then names instead of the job) and a branch up to date
  with `main` before it merges, so that the checks see what the merge produces, such as two ADRs
  proposed in parallel under one number, and blocks force pushes and branch deletion;
- enable **require a review from Code Owners** on that ruleset, so the two artifacts only a human
  decides, [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) and everything under
  [`docs/adr/`](docs/adr/) ([`AGENTS.md` §3](AGENTS.md#3-adr-rules)), and the protected parts of
  [ADR-0007](docs/adr/0007-harness.md) cannot be merged without the owner named in
  [`.github/CODEOWNERS`](.github/CODEOWNERS), which has to carry a real handle or team for the
  requirement to mean anything;
- enable **secret scanning with push protection**, the only mechanical backstop behind the secrets
  rule ([`AGENTS.md` §7](AGENTS.md#7-secrets)), which is otherwise carried by review alone;
- enable **private vulnerability reporting** (see [`SECURITY.md`](SECURITY.md)).

[`scripts/sensor-repo-settings.sh`](scripts/sensor-repo-settings.sh) reads these settings
through `gh` and reports each one that differs from this list. It runs on a human's
instruction ([ADR-0002](docs/adr/0002-decisions-verified-by-tests.md)).

## Reporting security issues

Do **not** open a public issue for vulnerabilities. Follow [`SECURITY.md`](SECURITY.md).
