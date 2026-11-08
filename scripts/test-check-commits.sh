#!/usr/bin/env bash
#
# Self-test of scripts/check-commits.sh.
#
# Decides no ADR clause and no criterion: a check of the kind AGENTS.md §5 asks for where a
# mistake could have been caught, a commit that passes the checks only together with a later one.
#
# Each case builds a throwaway repository under a temporary directory: a main with one commit and
# a branch on top, each commit carrying stand-ins for the four checks the script runs from the
# commit's tree. Stand-ins for those checks and for bun, bunx, and cargo on the PATH log each call
# with the commit it ran on, and fail where the commit's tree holds a file 'fail-<check>' or
# 'fail-<tool>-<word>', the word being the script of 'bun run' and else the first argument. The
# case runs the script and asserts its exit code, the commits and checks it names, and what it ran
# on which commit.
#
#   - Every commit passing passes, each check run once on each commit.
#   - A middle commit that fails the docs check fails, named with the check and its output, and
#     the commits around it are not; a failing traceability, comment-width, and structure check
#     are named too.
#   - A failing Cargo test is named and the checks after it still run; a failed install names the
#     checks it kept from running.
#   - The engine is built on the first commit and again only after one that changes crates/,
#     Cargo.toml, Cargo.lock, or package.json; a failed build keeps the type check and the Bun
#     tests from running, and the next commit builds it again.
#   - A file one commit's checks leave untracked is gone before the next commit's checks, and
#     what git ignores stays.
#   - The first commit of a numbering by scripts/number-adrs.sh is exempt, said to be, and counted
#     apart; one whose subject only resembles it is not exempt.
#   - The base defaults to the merge base with main, an explicit base and head bound the range,
#     and an empty range passes. The temporary worktree is gone afterwards, the checkout untouched.
#   - A hangup stops the running check at once, exits 129, and removes the worktree.
#   - An unknown option, a third argument, a revision that names no commit, and a temporary
#     directory that cannot be made exit 2.
#   - Each command the script runs is one of package.json's lint, test, build:engine, or
#     typecheck scripts, the install of scripts/check-code.sh, or one of the four bash checks it
#     names (docs, traceability, comment width, structure), which must exist; and each part of
#     package.json's lint and test is a command the script runs, but for the browser tests and
#     the engine's freshness check, for which the script's own engine build stands.
#
# ADR numbers inside fixtures are assembled, never written literally, so that
# scripts/check-docs.sh does not read this script's fixtures as references into this repository.
#
# Inputs: scripts/check-commits.sh scripts/lib/ package.json scripts/check-code.sh
#
# Usage:
#     scripts/test-check-commits.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/selftest.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/selftest.sh"
SCRIPT="$ROOT/scripts/check-commits.sh"

# id <number> — the identifier ADR-NNNN.
id() { printf 'ADR-%04d' "$1"; }

# The stand-ins for the toolchain, logging to $STUB_LOG. Where the tree holds 'make-stray', rustfmt
# leaves an untracked file 'stray'; 'slow-<tool>-<word>' makes a call sleep, writing its id first.
# The install says whether it found the node_modules/ an earlier commit's install left.
bin="$work/bin"
mkdir -p "$bin"
for tool in bun bunx cargo; do
  cat > "$bin/$tool" << 'EOF'
#!/usr/bin/env bash
tool="${0##*/}"
word="$1"
[[ "$tool" == bunx && "$1" == --bun ]] && word="$2"
[[ "$tool" == bun && "$1" == run ]] && word="$2"
subject="$(git log -1 --format=%s)"
echo "$subject | $tool $*" >> "$STUB_LOG"
[[ "$tool $word" == "cargo fmt" && -e make-stray ]] && echo stray > stray
if [[ "$tool $word" == "bun install" ]]; then
  [[ -d node_modules ]] && echo "$subject | node_modules kept" >> "$STUB_LOG"
  mkdir -p node_modules
fi
if [[ -e "slow-$tool-$word" ]]; then
  echo "$$" > "$STUB_LOG.pid"
  exec sleep 30
fi
[[ ! -e "fail-$tool-$word" ]]
EOF
  chmod +x "$bin/$tool"
done

# g <dir> <git args...> — git in a fixture.
g() {
  local dir="$1"; shift
  fixture "$dir"
  git -C "$dir" "$@"
}

# commit <dir> <subject> [<path to add>] [<path to remove>] — one commit of the fixture.
commit() {
  local dir="$1" subject="$2"
  [[ -n "${3:-}" ]] && { mkdir -p "$(dirname "$dir/$3")"; echo "$subject" > "$dir/$3"; }
  [[ -n "${4:-}" ]] && rm -f "$dir/$4"
  g "$dir" add -A && g "$dir" commit -q -m "$subject"
}

# repo <name> — the fixture: main with the stand-in checks and a .gitignore naming node_modules/,
# the branch work checked out on it. Each check fails on 'fail-<name>' and on a file 'stray'.
repo() {
  local dir="$work/$1" name
  mkdir -p "$dir/scripts"
  git init -q -b main "$dir"
  g "$dir" config user.name t
  g "$dir" config user.email t@t
  g "$dir" config commit.gpgsign false
  for name in docs traceability comment-width structure; do
    # shellcheck disable=SC2016 # the stand-in's own expansions, written as they are
    printf '%s\n' '#!/usr/bin/env bash' 'cd "$(dirname "$0")/.." || exit 1' "name=$name" \
      'echo "$(git log -1 --format=%s) | check $name" >> "$STUB_LOG"' \
      '[[ ! -e stray ]] || { echo "$name FAILED: stray"; exit 1; }' \
      '[[ ! -e "fail-$name" ]] || { echo "$name FAILED: fail-$name"; exit 1; }' \
      > "$dir/scripts/check-$name.sh"
  done
  echo "node_modules/" > "$dir/.gitignore"
  commit "$dir" main
  g "$dir" switch -q -c work
}

# run_script <name> [args...] — run the script on a fixture; sets out, rc, and the log.
run_script() {
  local name="$1"; shift
  mkdir -p "$work/tmp-$name"
  export STUB_LOG="$work/$name.log"
  : > "$STUB_LOG"
  out="$(cd "$work" && PATH="$bin:$PATH" TMPDIR="$work/tmp-$name" \
    bash "$SCRIPT" --root "$work/$name" "$@" 2>&1)"
  rc=$?
}

# The assertions, which check runs.
# shellcheck disable=SC2317,SC2329 # run by check
{
  not() { ! "$@"; }
  has() { [[ "$out" == *"$1"* ]]; }
  lacks() { [[ "$out" != *"$1"* ]]; }
  # summary_names <text> — whether the summary of failed commits has a line with the text.
  summary_names() { grep -qF -- "  - $1" <<< "$out"; }
  # logged <count> <pattern> — whether the stand-ins logged the pattern that many times.
  logged() { [[ "$(grep -cE -- "$2" "$STUB_LOG")" == "$1" ]]; }
  # worktree_gone <name> — the fixture has its own worktree only, and the temporary one's
  # directory is gone.
  worktree_gone() {
    [[ "$(g "$work/$1" worktree list --porcelain | grep -c '^worktree ')" -eq 1 \
      && -z "$(ls -A "$work/tmp-$1")" ]]
  }
  # in_file <file> <text> — whether the file holds the text.
  in_file() { grep -qF -- "$2" "$1"; }
  # is_step <command> — whether the script runs the command as one of its checks.
  is_step() { printf '%s\n' "${steps[@]}" | grep -qxF -- "$1"; }
  # alive <id> — whether the process runs.
  alive() { kill -0 "$1" 2> /dev/null; }
}
short() { g "$work/$1" rev-parse --short "$2"; }

# 1. Every commit passes: each ran every check, the engine built once.
repo pass
commit "$work/pass" one a.txt
commit "$work/pass" two b.txt
commit "$work/pass" three c.txt
run_script pass
check "all pass: exit 0" [ "$rc" -eq 0 ]
check "all pass: the summary" has "each of 3 commit(s) checked passes"
check "all pass: none exempt" lacks "exempt"
check "all pass: main is not checked" lacks "commit: $(short pass main)"
check "all pass: the docs check on each" logged 3 '\| check docs$'
check "all pass: the traceability check on each" logged 3 '\| check traceability$'
check "all pass: the comment-width check on each" logged 3 '\| check comment-width$'
check "all pass: the structure check on each" logged 3 '\| check structure$'
check "all pass: Cargo tests on each" logged 3 '\| cargo test --workspace$'
check "all pass: clippy and rustfmt on each" logged 6 '\| cargo (clippy|fmt) '
check "all pass: the install on each" logged 3 '\| bun install --frozen-lockfile$'
check "all pass: the type check on each" logged 3 '\| bun run typecheck$'
check "all pass: ESLint and Prettier on each" logged 6 '\| bunx --bun (eslint|prettier) '
check "all pass: the Bun tests on each" logged 3 '\| bun test packages/comb/src bench examples/uml/src$'
check "all pass: the engine built once, on the first" logged 1 '^one \| bun run build:engine$'
check "all pass: no other engine build" logged 1 'build:engine'
check "all pass: the temporary worktree is gone" worktree_gone pass
check "all pass: the checkout is untouched" [ -z "$(g "$work/pass" status --porcelain)" ]
check "all pass: still on the branch" [ "$(g "$work/pass" symbolic-ref --short HEAD)" == work ]

# 2. The middle commit fails the docs check: it is named with the check, the others are not.
repo middle
commit "$work/middle" "first fine" a.txt
commit "$work/middle" "breaks the docs" fail-docs
commit "$work/middle" "mends the docs" c.txt fail-docs
run_script middle
check "middle: exit 1" [ "$rc" -eq 1 ]
check "middle: names the commit and the check" summary_names "$(short middle HEAD~1) breaks the docs — docs"
check "middle: one commit failed" has "1 of 3 commit(s) checked"
check "middle: the first is not named" not summary_names "$(short middle HEAD~2)"
check "middle: the last is not named" not summary_names "$(short middle HEAD)"
check "middle: the check's output is shown" has "docs FAILED: fail-docs"

# The traceability, the comment-width, and the structure check, failing one commit each, are
# named the same way.
repo checks
commit "$work/checks" "breaks traceability" fail-traceability
commit "$work/checks" "breaks the comment width" fail-comment-width fail-traceability
commit "$work/checks" "breaks the structure" fail-structure fail-comment-width
commit "$work/checks" "mends all" c.txt fail-structure
run_script checks
check "checks: exit 1" [ "$rc" -eq 1 ]
check "checks: traceability named" summary_names "$(short checks HEAD~3) breaks traceability — traceability"
check "checks: comment width named" \
  summary_names "$(short checks HEAD~2) breaks the comment width — comment width"
check "checks: structure named" summary_names "$(short checks HEAD~1) breaks the structure — structure"
check "checks: the last is not named" not summary_names "$(short checks HEAD)"
check "checks: the outputs are shown" has "traceability FAILED: fail-traceability"
check "checks: the structure output is shown" has "structure FAILED: fail-structure"

# 3. The engine is built again after a commit that changes one of its inputs, and only then.
repo engine
commit "$work/engine" "e one" a.txt
commit "$work/engine" "e crates" crates/engine/src/lib.rs
commit "$work/engine" "e toml" Cargo.toml
commit "$work/engine" "e lock" Cargo.lock
commit "$work/engine" "e package" package.json
commit "$work/engine" "e other" c.txt
run_script engine
check "engine: exit 0" [ "$rc" -eq 0 ]
check "engine: built on the first" logged 1 '^e one \| bun run build:engine$'
check "engine: built after crates/ changed" logged 1 '^e crates \| bun run build:engine$'
check "engine: built after Cargo.toml changed" logged 1 '^e toml \| bun run build:engine$'
check "engine: built after Cargo.lock changed" logged 1 '^e lock \| bun run build:engine$'
check "engine: built after package.json changed" logged 1 '^e package \| bun run build:engine$'
check "engine: not built when nothing changed" logged 0 '^e other \| bun run build:engine$'

# A failed engine build keeps the type check and the Bun tests from running, not ESLint and
# Prettier, and the next commit builds it again though no input changed.
repo enginefail
commit "$work/enginefail" "f breaks the build" fail-bun-build:engine
commit "$work/enginefail" "f mends it" c.txt fail-bun-build:engine
run_script enginefail
check "engine fails: exit 1" [ "$rc" -eq 1 ]
check "engine fails: the build and what it kept from running" summary_names \
  "$(short enginefail HEAD~1) f breaks the build — engine build, type check (not run), Bun tests (not run)"
check "engine fails: no type check or Bun tests" logged 0 '^f breaks the build \| bun (run typecheck|test)'
check "engine fails: ESLint and Prettier ran" logged 2 '^f breaks the build \| bunx --bun (eslint|prettier) '
check "engine fails: built again on the next" logged 1 '^f mends it \| bun run build:engine$'
check "engine fails: the next is not named" not summary_names "$(short enginefail HEAD)"

# 4. A failing Cargo test is named and the checks after it run; a failed install names what it
# kept from running.
repo code
commit "$work/code" "breaks a test" fail-cargo-test
commit "$work/code" "breaks the install" fail-bun-install fail-cargo-test
run_script code
check "code: exit 1" [ "$rc" -eq 1 ]
check "code: the Cargo tests named" summary_names "$(short code HEAD~1) breaks a test — Cargo tests"
check "code: the checks after the Cargo tests ran" \
  logged 4 '^breaks a test \| (bun install|bun run typecheck|bunx --bun eslint|bun test)'
check "code: the install and what it kept from running" summary_names \
  "$(short code HEAD) breaks the install — install, engine build (not run), type check (not run), ESLint (not run), Prettier (not run), Bun tests (not run)"
check "code: nothing ran past the failed install" logged 0 '^breaks the install \| (bunx|bun (run|test))'

# 5. What one commit's checks leave untracked is gone before the next commit's checks; what git
# ignores, such as the install, stays.
repo stray
commit "$work/stray" "s leaves a file" make-stray
commit "$work/stray" "s next" c.txt make-stray
run_script stray
check "stray: exit 0" [ "$rc" -eq 0 ]
check "stray: the file was left" logged 1 '^s leaves a file \| cargo fmt'
check "stray: the install stayed" logged 1 '^s next \| node_modules kept$'

# 6. The first commit of a numbering is exempt, said to be, and counted apart; a look-alike is not.
repo numbering
commit "$work/numbering" "docs(adr): number the drafts as $(id 3) to $(id 4)" fail-docs
commit "$work/numbering" "chore: cite $(id 3) to $(id 4) by number, no longer as drafts" c.txt fail-docs
run_script numbering
check "numbering: exit 0" [ "$rc" -eq 0 ]
check "numbering: the exemption is said" has "exempt: $(short numbering HEAD~1) docs(adr): number the drafts"
check "numbering: the exempt commit runs nothing" logged 0 '^docs\(adr\)'
check "numbering: the second commit is checked" has "commit: $(short numbering HEAD) chore: cite"
check "numbering: counted apart" has "each of 1 commit(s) checked passes the checks on its own (1 exempt)."
repo lookalike
commit "$work/lookalike" "docs(adr): number the drafts as $(id 3) and more" fail-docs
run_script lookalike
check "look-alike: exit 1" [ "$rc" -eq 1 ]
check "look-alike: not exempt" lacks "exempt"

# 7. The range: an explicit base, an explicit head, and an empty range.
run_script pass "$(short pass HEAD~2)"
check "base: exit 0" [ "$rc" -eq 0 ]
check "base: two commits" has "each of 2 commit(s) checked"
check "base: the base itself is not checked" lacks "commit: $(short pass HEAD~2)"
run_script middle main HEAD~2
check "head: exit 0 up to the first" [ "$rc" -eq 0 ]
check "head: one commit" has "each of 1 commit(s) checked"
run_script pass HEAD
check "empty range: exit 0" [ "$rc" -eq 0 ]
check "empty range: says so" has "nothing to check"

# 8. A hangup stops the running check at once and removes the worktree.
repo signal
commit "$work/signal" "slow rustfmt" slow-cargo-fmt
mkdir -p "$work/tmp-signal"
export STUB_LOG="$work/signal.log"
: > "$STUB_LOG"
(cd "$work" && PATH="$bin:$PATH" TMPDIR="$work/tmp-signal" \
  exec bash "$SCRIPT" --root "$work/signal") > "$work/signal.out" 2>&1 &
script_pid=$!
for _ in $(seq 200); do [[ -s "$STUB_LOG.pid" ]] && break; sleep 0.05; done
started=$SECONDS
kill -HUP "$script_pid"
wait "$script_pid"
rc=$?
check "hangup: exit 129" [ "$rc" -eq 129 ]
check "hangup: not waiting for the check" [ $((SECONDS - started)) -lt 10 ]
check "hangup: the check is stopped" not alive "$(cat "$STUB_LOG.pid" 2> /dev/null || echo 0)"
check "hangup: the temporary worktree is gone" worktree_gone signal

# 9. The refusals.
run_script pass --verbose
check "unknown option: exit 2" [ "$rc" -eq 2 ]
run_script pass main HEAD extra
check "third argument: exit 2" [ "$rc" -eq 2 ]
run_script pass no-such-revision
check "no such base: exit 2" [ "$rc" -eq 2 ]
check "no such base: named" has "'no-such-revision' names no commit"
out="$(cd "$work" && PATH="$bin:$PATH" TMPDIR="$work/no-such-directory" \
  bash "$SCRIPT" --root "$work/pass" main 2>&1)"
rc=$?
check "no temporary directory: exit 2" [ "$rc" -eq 2 ]

# 10. The commands against package.json and scripts/check-code.sh, both ways.
mapfile -t steps < <(sed -nE 's/^[[:space:]]*(if )?step "[^"]+" (.*)$/\2/p' "$SCRIPT" | sed 's/; then.*//')
check "commands: the script runs thirteen checks" [ "${#steps[@]}" -eq 13 ]
for cmd in "${steps[@]}"; do
  case "$cmd" in
    "bash scripts/"*) check "commands: '$cmd' exists" [ -f "$ROOT/${cmd#bash }" ] ;;
    "bun install"*) check "commands: '$cmd' is check-code's install" in_file "$ROOT/scripts/check-code.sh" "$cmd" ;;
    "bun run "*) check "commands: '$cmd' is a script of package.json" in_file "$ROOT/package.json" "\"${cmd#bun run }\":" ;;
    *) check "commands: '$cmd' is in package.json" in_file "$ROOT/package.json" "$cmd" ;;
  esac
done
for script in lint test; do
  value="$(sed -nE "s/^[[:space:]]*\"$script\": \"(.*)\",?\$/\\1/p" "$ROOT/package.json")"
  check "commands: package.json has a $script script" [ -n "$value" ]
  while IFS= read -r part; do
    case "$part" in
      "bunx --bun playwright test" | "bash scripts/check-engine.sh") continue ;;
    esac
    check "commands: '$part' of package.json's $script is run" is_step "$part"
  done <<< "${value// && /$'\n'}"
done

summary "Commit checks self-test"
