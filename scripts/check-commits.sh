#!/usr/bin/env bash
#
# Runs the checks on every commit of a branch, each on its own tree: a commit that leans on a later
# one to pass is a commit that cannot be reverted, bisected, or reviewed alone, and the reviews of
# the state diagram's tickets kept finding such commits by hand. Dev-only tooling of the kind
# AGENTS.md §5 asks for where a mistake could have been caught; it decides no ADR or criterion.
#
# Every commit between the base and the head, merges included, oldest first, is checked out in a
# temporary worktree under mktemp's directory, removed again on every exit, and these run there,
# each from the commit's own tree, so a commit is held to the checks it carries. Before each
# commit's checks, the files the previous one left that git neither tracks nor ignores are
# removed, so that none reaches the next commit's checks; the install, the built engine, and what
# else git ignores stay:
#
#   docs, traceability, comment width,  scripts/check-docs.sh, scripts/check-traceability.sh,
#   structure                           scripts/check-comment-width.sh, scripts/check-structure.sh
#   rustfmt, clippy, Cargo tests        the Rust parts of 'bun run lint' and 'bun run test'
#   install, engine build, type check   'bun install --frozen-lockfile', 'bun run build:engine',
#                                       'bun run typecheck'
#   ESLint, Prettier, Bun tests         the TypeScript parts of 'bun run lint' and 'bun run test'
#
# The commands mirror the scripts of package.json and leave out the Playwright tests and the builds
# of the examples, which stay with scripts/check-code.sh at the head; the self-test holds each
# against package.json and scripts/check-code.sh, both ways. The engine is built for the
# first commit and again only after a commit that changes crates/, Cargo.toml, Cargo.lock, or
# package.json, into a Cargo target directory of its own, target/check-commits/ of the repository
# the script runs from, kept between runs so that a second run builds only what changed. Where the
# install fails, the checks that need it do not run, nor do the type check and the Bun tests where
# the engine build fails; each is reported as not run.
#
# One commit is exempt: the first of the two commits by which scripts/number-adrs.sh numbers the
# drafts, known by its fixed subject 'docs(adr): number the drafts as ADR-…'. Its tree still cites
# the drafts outside docs/adr/, so the checks fail on it and pass on the second, as ADR-0002
# decides; the script says so for each one it exempts.
#
# Needs git, and Bun and Cargo as the Dev Container provides them (ADR-0014). Runs before a merge,
# on a human's instruction (step 2 of the Integration branches of CONTRIBUTING.md); it is no gate
# of scripts/check-all.sh or CI, which run its self-test, scripts/test-check-commits.sh.
#
# Usage:
#     scripts/check-commits.sh [--root <dir>] [<base> [<head>]]
# The base defaults to the merge base of the head with origin/main, else main; a ticket branch
# stacked on another names the other's tip. The head defaults to HEAD. --root names another
# repository, as the self-test does with each fixture.
# Exit code 0 when every commit passes every check, 1 when any commit fails one, 2 on an unknown
# argument, a revision that does not exist, no base to default to, or a temporary worktree that
# could not be made. A signal stops the running check and removes the worktree; what that check
# started in turn may outlive it.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/git.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/git.sh"

usage="usage: scripts/check-commits.sh [--root <dir>] [<base> [<head>]]"
enter_root "check-commits" "${BASH_SOURCE[0]}" "$@"
shift "$ROOT_TAKEN"
for arg in "$@"; do
  [[ "$arg" == -* ]] && { echo "check-commits: unknown argument '$arg' — $usage" >&2; exit 2; }
done
(($# <= 2)) || { echo "check-commits: too many arguments — $usage" >&2; exit 2; }
ROOT="$(pwd)"

head_rev="${2:-HEAD}"
head="$(git rev-parse -q --verify "$head_rev^{commit}")" \
  || { echo "check-commits: '$head_rev' names no commit." >&2; exit 2; }
if (($# >= 1)); then
  base_rev="$1"
else
  base_rev="$(main_merge_base "$head")" \
    || { echo "check-commits: the head has no merge base with origin/main or main; name the base — $usage" >&2; exit 2; }
fi
base="$(git rev-parse -q --verify "$base_rev^{commit}")" \
  || { echo "check-commits: '$base_rev' names no commit." >&2; exit 2; }

mapfile -t commits < <(git rev-list --reverse --topo-order "$base..$head")
if ((${#commits[@]} == 0)); then
  echo "check-commits: no commit between $(git rev-parse --short "$base") and $head_rev, nothing to check."
  exit 0
fi

# The subject scripts/number-adrs.sh gives the first commit of a numbering.
numbering='^docs\(adr\): number the drafts as ADR-[0-9]{4}( to ADR-[0-9]{4})?$'

tmp="$(mktemp -d "${TMPDIR:-/tmp}/check-commits.XXXXXX")" \
  || { echo "check-commits: no temporary directory could be made." >&2; exit 2; }
tree="$tmp/tree"
pid="" # the running check, which a signal stops
# shellcheck disable=SC2317 # run by the traps
stop() {
  [[ -n "$pid" ]] && kill "$pid" 2> /dev/null
  exit "$1"
}
# shellcheck disable=SC2317 # run by the trap
cleanup() {
  [[ -d "$tree" ]] && git -C "$ROOT" worktree remove --force "$tree" > /dev/null 2>&1
  rm -rf "$tmp"
  git -C "$ROOT" worktree prune > /dev/null 2>&1
}
trap cleanup EXIT
trap 'stop 129' HUP
trap 'stop 130' INT
trap 'stop 143' TERM

if ! git worktree add -q --detach "$tree" "${commits[0]}" > "$tmp/add.log" 2>&1; then
  echo "check-commits: the temporary worktree could not be added:" >&2
  cat "$tmp/add.log" >&2
  exit 2
fi
export CARGO_TARGET_DIR="$ROOT/target/check-commits"

failed=() # one line per commit that failed: the commit and the checks it failed
fails=()  # the checks the current commit failed

# step <name> <command...> — run one check in the commit's tree; a failure prints its output.
# The check runs in the background and is waited for, so that a signal is taken at once.
step() {
  local name="$1" rc
  shift
  (cd "$tree" && exec "$@") > "$tmp/step.log" 2>&1 < /dev/null &
  pid=$!
  wait "$pid"
  rc=$?
  pid=""
  if ((rc == 0)); then
    return 0
  fi
  fails+=("$name")
  echo "  FAILED: $name — $*"
  sed 's/^/    /' "$tmp/step.log"
  return 1
}

# not_run <name...> — checks a failed prerequisite keeps from running, counted as failed.
not_run() {
  local name
  for name in "$@"; do
    fails+=("$name (not run)")
    echo "  not run: $name"
  done
}

built="" # the commit whose engine the tree holds, empty while it holds none
exempt=0
for c in "${commits[@]}"; do
  label="$(git log -1 --format='%h %s' "$c")"
  if [[ "$(git log -1 --format=%s "$c")" =~ $numbering ]]; then
    echo "exempt: $label — the first commit of a numbering by scripts/number-adrs.sh, whose tree still cites the drafts outside docs/adr/; the checks run on the second (ADR-0002)"
    exempt=$((exempt + 1))
    continue
  fi
  echo "commit: $label"
  fails=()
  if ! { git -C "$tree" checkout -q --force --detach "$c" && git -C "$tree" clean -q -f -d; } \
    > "$tmp/step.log" 2>&1; then
    failed+=("$label — checkout")
    sed 's/^/    /' "$tmp/step.log"
    continue
  fi

  step "docs" bash scripts/check-docs.sh
  step "traceability" bash scripts/check-traceability.sh
  step "comment width" bash scripts/check-comment-width.sh
  step "structure" bash scripts/check-structure.sh
  step "rustfmt" cargo fmt --all --check
  step "clippy" cargo clippy --workspace --all-targets --all-features -- -D warnings
  step "Cargo tests" cargo test --workspace
  if step "install" bun install --frozen-lockfile; then
    engine=1
    if [[ -z "$built" ]] || ! git diff --quiet "$built" "$c" -- crates Cargo.toml Cargo.lock package.json; then
      built=""
      if step "engine build" bun run build:engine; then built="$c"; else engine=0; fi
    fi
    if ((engine)); then
      step "type check" bun run typecheck
    else
      not_run "type check"
    fi
    step "ESLint" bunx --bun eslint .
    step "Prettier" bunx --bun prettier --check .
    if ((engine)); then
      step "Bun tests" bun test packages/comb/src bench examples/uml/src
    else
      not_run "Bun tests"
    fi
  else
    not_run "engine build" "type check" "ESLint" "Prettier" "Bun tests"
  fi

  if ((${#fails[@]})); then
    failed+=("$label — $(printf '%s, ' "${fails[@]}" | sed 's/, $//')")
  else
    echo "  ok"
  fi
done

checked=$((${#commits[@]} - exempt))
also=""
((exempt)) && also=" ($exempt exempt)"
echo
if ((${#failed[@]})); then
  echo "check-commits FAILED: ${#failed[@]} of $checked commit(s) checked fail a check on their own$also:" >&2
  printf '  - %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "check-commits passed: each of $checked commit(s) checked passes the checks on its own$also."
