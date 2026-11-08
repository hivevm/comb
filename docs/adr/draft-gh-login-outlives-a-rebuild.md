# ADR-draft-gh-login-outlives-a-rebuild: The Dev Container keeps its GitHub login in the host's `~/.config/gh`

- **Status:** 🟡 proposed
- **Date:** 2026-11-07
- **Deciders:** Markus Brigl
- **Applies to:** the mounts, `initializeCommand`, and `postStartCommand` of `.devcontainer/devcontainer.json`, `scripts/check-devcontainer.sh`, and `scripts/test-check-devcontainer.sh`

## Context

The coding agent and the maintainer reach GitHub from the Dev Container through the GitHub CLI,
`gh`, which the container takes as a Feature and which serves as git's credential helper
([ADR-0004](0004-dev-container-runtime.md) keeps the container's other boundaries). `gh auth
login` stores its token in the system's credential store, and where it finds none, as in the
container, "in a plain text file", `~/.config/gh/hosts.yml`. That file lives in the container and
is gone after every rebuild. git uses `gh` only once `gh auth setup-git` has configured it as the
credential helper, which nothing runs. On 2026-11-07 a push of `feat/dev` failed twice on this:
`gh` had no valid login, and once it had, git still asked for a user name it could not read.

[ADR-0004](0004-dev-container-runtime.md) names the cost of what the container mounts: third-party
code, its Features at build time and the dependencies the work installs, runs next to the
credentials it mounts. It already mounts the agent's configuration from the host
(`~/.claude`), and keeps the container out of the host's container engine; it leaves hardening
the container out of scope, since the container is no security boundary.
[ADR-0016](0016-no-secrets.md) keeps secrets out of the repository; a token in the host's home
directory is outside it.

No goal or quality goal of [`docs/SPECIFICATION.md`](../SPECIFICATION.md) is served directly; the
decision serves the working environment of every session, as ADR-0004 does.

## Decision

We will keep the Dev Container's GitHub login across rebuilds by bind-mounting the host's
`~/.config/gh` at `/home/vscode/.config/gh`, created by `initializeCommand` before the container
is, and by configuring git on every start to take its GitHub credentials from `gh`
(`gh auth setup-git --hostname github.com --force`, which succeeds while nobody is logged in).

The token is the one `gh auth login` grants, with the scopes of its default login, for every
repository its account reaches; a narrower token is the human's to choose at login and needs no
change here. A push and every `gh` action still wait for a human's instruction
([`AGENTS.md` §6](../../AGENTS.md#6-project-rules)).

**Out of scope:** where the host's own `gh` keeps its login (its keyring stays untouched; a login
made on the host is shared only if the host writes `hosts.yml` in plain text); other credentials;
hardening the container.

## Alternatives considered

- **A host `GH_TOKEN` handed in through `remoteEnv`** — no file in the container, but the token
  must be set on the host before VS Code starts, and a `gh auth login` made in the container is
  lost again with the next rebuild.
- **VS Code's forwarding of the host's git credential helper alone** — needs nothing in the
  definition and serves `git push`, but `gh` itself, pull requests and the API, stays logged out
  after every rebuild.
- **A fine-grained personal access token for this repository only** — the smaller loss on a leak,
  but one more token to renew before it expires; the maintainer chose the default login, and this
  decision does not stand in the way of the narrower token.
- **A named volume instead of a bind mount** — survives a rebuild too, but is lost with the
  volume, invisible from the host, and shared by every project that names it.
- **Logging in after every rebuild** — what happened so far: a step forgotten, and a push that
  fails in the middle of a hand-off.

## Sources / Prior art

- GitHub CLI manual, `gh auth login` — <https://cli.github.com/manual/gh_auth_login>: the token
  goes to the system's credential store, with a plain-text file as fallback;
  `--insecure-storage` writes it in plain text.
- GitHub CLI manual, `gh auth setup-git` — <https://cli.github.com/manual/gh_auth_setup-git>: it
  makes `gh` git's credential helper, fails with no authenticated host, and with `--hostname` and
  `--force` sets it up for a host not yet known.
- Dev Container specification, `mounts`, `initializeCommand`, `postStartCommand` —
  <https://containers.dev/implementors/json_reference/>.
- VS Code, *Sharing Git credentials with your container* —
  <https://code.visualstudio.com/remote/advancedcontainers/sharing-git-credentials>.

## Consequences

- Positive: a login made once in the container holds across rebuilds; `git push` and `gh`
  authenticate without a prompt; the definition keeps one pattern for what it takes from the host.
- Negative / trade-offs: a long-lived token with push rights to every repository of the account
  lies in plain text in the host's `~/.config/gh` and in reach of everything the container runs,
  the agent, the Features, and the installed dependencies included; a leak is remedied by revoking
  the token on GitHub. On Linux a host `gh` that writes `hosts.yml` in plain text shares the login
  with the container both ways.
- Follow-ups: whether a token narrowed to the repository should be the documented default.

## Enforcement

[`scripts/check-devcontainer.sh`](../../scripts/check-devcontainer.sh) fails when
[`devcontainer.json`](../../.devcontainer/devcontainer.json) no longer bind-mounts
`${localEnv:HOME}${localEnv:USERPROFILE}/.config/gh` at `/home/vscode/.config/gh`, when its
`initializeCommand` no longer creates that source, or when its `postStartCommand` no longer runs
`gh auth setup-git`. Its self-test cites this ADR with a `Verifies:` marker
([ADR-0002](0002-decisions-verified-by-tests.md)). Not checked: that the login holds after a
rebuild. The `smoke` job of
[`devcontainer.yml`](../../.github/workflows/devcontainer.yml) builds the container on Linux and
so runs the `initializeCommand`, the mount, and `gh auth setup-git`, but logs nobody in, so only
a rebuild after a login shows that the login holds.
