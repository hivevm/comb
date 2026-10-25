#!/usr/bin/env bash
#
# Self-test of the git hooks under .githooks/: pre-commit refuses a commit on main, pre-push
# refuses a push while the checks are red (AGENTS.md, sections 5 and 6), and pre-merge-commit
# refuses a merge commit on main while the documentation check or the plan frontier sensor fails
# or is missing.
#
# Each case builds a throwaway repository under a temporary directory with core.hooksPath pointing
# at this repository's .githooks/, runs a real 'git commit', 'git push', or 'git merge --no-ff' in
# it — the push goes to a bare repository next to it — and asserts the exit code and, for a
# refused command, the message. A push case ships its own scripts/check-all.sh, green or red, so
# the test decides what the hook finds. A merge case ships this repository's plan frontier sensor
# and, as its scripts/check-docs.sh, a stand-in that fails on a Markdown line over 100 columns,
# the rule of the real check a merge breaks most easily, and that fails as well when git run in
# another repository still sees the hook's repository; one case merges in a linked worktree,
# where git hands the hook absolute paths, and a tag named 'main' is played against both hooks
# that gate main.
#
# Usage:
#     scripts/test-git-hooks.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/.githooks"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# g <dir> <git args...> — git in the fixture with an identity, so that commits need no config.
g() {
  local dir="$1"; shift
  git -C "${dir:?}" -c user.name=t -c user.email=t@example.invalid "$@"
}

# repo <name> — a fixture repository with one commit on main, the hooks enabled after that
# commit, and a bare remote 'origin' to push to. Prints its path.
repo() {
  local dir="$work/$1"
  mkdir -p "$dir"
  git -C "${dir:?}" init -q -b main
  g "$dir" commit -q --allow-empty -m init
  git -C "${dir:?}" config core.hooksPath "$HOOKS"
  git init -q --bare "$dir.git"
  git -C "${dir:?}" remote add origin "$dir.git"
  echo "$dir"
}

# checks <dir> <exit code> — give the fixture a scripts/check-all.sh that exits as told.
checks() {
  mkdir -p "$1/scripts"
  printf '#!/usr/bin/env bash\necho "check output for the test"\nexit %s\n' "$2" > "$1/scripts/check-all.sh"
}

# expect <pass|refuse> <name> <dir> <needle> <git args...> — run the git command; a refused one
# must exit non-zero with the needle in its output, a passing one exit zero.
expect() {
  local want="$1" name="$2" dir="$3" needle="$4"
  shift 4
  local out rc
  out="$(g "$dir" "$@" 2>&1)"; rc=$?
  if [[ "$want" == "pass" && $rc -eq 0 ]] \
     || [[ "$want" == "refuse" && $rc -ne 0 && "$out" == *"$needle"* ]]; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected $want${needle:+ with \"$needle\"}, exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

# --- cases ---------------------------------------------------------------------------------

d="$(repo on-main)"
expect refuse "a commit on main" "$d" "on 'main'" commit -q --allow-empty -m x
expect pass "a push from main with no check script to run" "$d" "" push -q origin main

d="$(repo tag-main)"
git -C "${d:?}" tag main
expect refuse "a commit on main beside a tag named main" "$d" "on 'main'" commit -q --allow-empty -m x

d="$(repo on-branch)"
git -C "${d:?}" switch -q -c feature
expect pass "a commit on a branch" "$d" "" commit -q --allow-empty -m x

d="$(repo red)"
git -C "${d:?}" switch -q -c feature
checks "$d" 1
expect refuse "a push while the checks are red" "$d" "the checks are red" push -q origin feature
expect refuse "the refusal shows the check output" "$d" "check output for the test" push -q origin feature
expect pass "a commit is not gated by the checks" "$d" "" commit -q --allow-empty -m x

d="$(repo green)"
git -C "${d:?}" switch -q -c feature
checks "$d" 0
expect pass "a push while the checks are green" "$d" "" push -q origin feature

d="$(repo detached)"
git -C "${d:?}" checkout -q --detach
expect pass "a commit on a detached HEAD is not on main" "$d" "" commit -q --allow-empty -m x

# merging <name> — a fixture repository whose main carries a stand-in scripts/check-docs.sh and
# this repository's plan frontier sensor, committed before the hooks are enabled. Prints its path.
merging() {
  local dir="$work/$1"
  mkdir -p "$dir/scripts"
  git -C "${dir:?}" init -q -b main
  cat > "$dir/scripts/check-docs.sh" <<'STAND_IN'
#!/usr/bin/env bash
other="$(mktemp -d)"
git -C "$other" init -q
[[ -z "$(git -C "$other" ls-files)" ]] \
  || { echo "the hook's git variables reached another repository"; exit 1; }
rm -rf "$other"
long="$(git ls-files '*.md' | xargs -r awk 'length > 100 { print FILENAME ": " FNR }')"
[[ -z "$long" ]] || { echo "line over 100 columns: $long"; exit 1; }
STAND_IN
  cp "$ROOT/scripts/sensor-plan-frontier.sh" "$dir/scripts/"
  g "$dir" add scripts
  g "$dir" commit -q -m init
  git -C "${dir:?}" config core.hooksPath "$HOOKS"
  echo "$dir"
}

# branch_with <dir> <branch> <path> <content> — a branch off main that commits one file.
branch_with() {
  git -C "${1:?}" switch -q -c "$2" main
  mkdir -p "$(dirname "$1/$3")"
  printf '%s\n' "$4" > "$1/$3"
  g "$1" add "$3"
  g "$1" commit -q -m "$2"
  git -C "${1:?}" switch -q main
}

LONG="$(printf 'word %.0s' {1..20})x"   # 101 columns of prose

d="$(merging merge-long-line)"
branch_with "$d" feature docs/notes.md "$LONG"
expect refuse "a merge commit on main with a line over 100 columns" "$d" "scripts/check-docs.sh" \
  merge -q --no-ff -m merge feature

d="$(merging merge-blocker)"
branch_with "$d" feature docs/plan/s/01-a.md \
  "$(printf '# Ticket\n\n## Blocked by\n\n- [a link](x.md)\n\n## Mode\n\nunattended')"
expect refuse "a merge commit on main with a blocker the sensor cannot read" "$d" \
  "scripts/sensor-plan-frontier.sh" merge -q --no-ff -m merge feature

d="$(merging merge-green)"
branch_with "$d" feature docs/notes.md "A short line."
expect pass "a merge commit on main of a green branch" "$d" "" merge -q --no-ff -m merge feature

d="$(merging merge-elsewhere)"
branch_with "$d" feature docs/notes.md "$LONG"
git -C "${d:?}" switch -q -c other main
expect pass "a merge commit into a branch other than main" "$d" "" merge -q --no-ff -m merge feature

d="$(merging merge-tag-main)"
branch_with "$d" feature docs/notes.md "$LONG"
git -C "${d:?}" tag main
expect refuse "a merge commit on main beside a tag named main" "$d" "scripts/check-docs.sh" \
  merge -q --no-ff -m merge feature

d="$(merging merge-missing)"
git -C "${d:?}" switch -q -c feature
g "$d" rm -q scripts/check-docs.sh
g "$d" commit -q -m "drop the check"
git -C "${d:?}" switch -q main
expect refuse "a merge commit on main that removes a check" "$d" \
  "scripts/check-docs.sh is missing" merge -q --no-ff -m merge feature

d="$(merging merge-worktree)"
branch_with "$d" red docs/notes.md "$LONG"
branch_with "$d" green docs/notes.md "A short line."
git -C "${d:?}" switch -q -c park
git -C "${d:?}" worktree add -q "$d-wt" main
expect refuse "a red merge commit on main in a linked worktree" "$d-wt" "scripts/check-docs.sh" \
  merge -q --no-ff -m merge red
git -C "$d-wt" merge --abort
expect pass "a green merge commit on main in a linked worktree" "$d-wt" "" \
  merge -q --no-ff -m merge green

# --- summary -------------------------------------------------------------------------------

if ((failed)); then
  echo "git hooks self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "git hooks self-test passed ($passed cases)."
exit 0
