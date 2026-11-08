#!/usr/bin/env bash
#
# Runs every consistency check this repository enforces, in one command.
#
# AGENTS.md §5 requires these checks to pass before pushing. This script is the local equivalent of
# .github/workflows/checks.yml; check 9 of check-docs.sh holds the two lists, the required status
# checks named in CONTRIBUTING.md, and the scripts under scripts/ together. A script that runs on a
# human's instruction only is named on an '# On instruction:' line below, and a workflow that
# publishes rather than checks, such as a release, on a '# Not a gate:' line.
#
# Every check runs even after an earlier one fails, so a single run reports everything that is
# wrong instead of the first thing. The exit code is what a pre-push decision is made on.
#
# A check or self-test that passes shows its last line, its summary, and any line that says it
# skipped something, such as the shell lint without ShellCheck. A sensor shows its first line, the
# headline that says what it found, and how many more lines its report has, blank ones not
# counted. One that fails shows all it printed. A session reads every line a run prints, so a
# green run costs a line a check. With --verbose every check and sensor shows all it printed; the
# reviewer is handed that output.
#
# With --changed, a self-test (scripts/test-*.sh) runs only where the branch changed what it
# tests: the self-test itself or a path its '# Inputs:' header line names, changed in the working
# tree against the merge base with origin/main, else main, untracked files included. A path in
# that line is a file, or with a trailing '/' a directory. A self-test without the line or naming
# a path that does not exist runs, and so does everything on main or without such a merge base.
# The checks, the sensors, and a project's build, test, and lint always run. The hooks run this
# mode before a push and on the conclusion of a conflicted merge; CI runs every self-test, so what
# is skipped here is still decided before anything reaches main.
#
# Pure bash + coreutils/git. The individual checks state their own dependencies — the shell lint
# needs ShellCheck and skips itself with a notice where it is missing.
#
# Usage:
#     scripts/check-all.sh [--changed] [--verbose]   (or: bash scripts/check-all.sh …)
# CHECK_ALL_JOBS=<n> runs at most n checks at once, 1 one after another; the default is the
# number of processors.
# Exit code 0 when every check passes, 1 when any of them fails, 2 on an unknown argument or a
# CHECK_ALL_JOBS that is no number from 1 up.

set -uo pipefail

# The checks need bash 4.4 or later (ADR-0002). This guard runs first and is written for bash
# 3.2, so an older bash, such as the one macOS ships, gets a message instead of a check failing
# on a construct it lacks. CHECK_ALL_BASH_VERSION stands in for the version found, for the
# self-test.
bash_found="${CHECK_ALL_BASH_VERSION:-${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}}"
bash_major="${bash_found%%.*}" bash_minor="${bash_found#*.}"
bash_minor="${bash_minor%%.*}"
if ((bash_major < 4 || (bash_major == 4 && bash_minor < 4))); then
  echo "check-all: the checks need bash 4.4 or later (ADR-0002); this is bash $bash_found — run them in the Dev Container, or install a current bash" >&2
  exit 2
fi

# shellcheck source-path=SCRIPTDIR source=lib/git.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/git.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

changed_mode=0
verbose=0
for arg in "$@"; do
  case "$arg" in
    --changed) changed_mode=1 ;;
    --verbose) verbose=1 ;;
    *) echo "check-all: unknown argument '$arg' — usage: scripts/check-all.sh [--changed] [--verbose]" >&2; exit 2 ;;
  esac
done

# The paths changed against the merge base with origin/main, else main, read once: the local
# main may lag the remote's, or a clone without the hooks may have moved it. On main, or without
# a merge base, changed mode is off and everything runs.
changed=()
if ((changed_mode)); then
  branch="$(git -C "$ROOT" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  base="$(cd "$ROOT" && main_merge_base HEAD)"
  if [[ "$branch" == "main" || -z "$base" ]]; then
    changed_mode=0
  else
    # NUL-separated: on lines, git quotes a path with a special character, which then matches no
    # input.
    mapfile -d '' -t changed < <(
      git -C "$ROOT" diff -z --name-only --no-renames "$base" --
      git -C "$ROOT" ls-files -z --others --exclude-standard
    )
  fi
fi

# needs_run <script> — whether a script runs in changed mode: it is no self-test, it names no
# inputs or one that does not exist, or a changed path is the self-test or one of its inputs.
needs_run() {
  local script="$1" line path c
  local -a inputs
  [[ "$script" == scripts/test-*.sh ]] || return 0
  line="$(grep -m1 '^# Inputs:' "$ROOT/$script")" || return 0
  read -r -a inputs <<< "${line#"# Inputs:"}"
  ((${#inputs[@]})) || return 0
  for path in "${inputs[@]}"; do
    [[ -e "$ROOT/$path" ]] || return 0
  done
  for c in "${changed[@]}"; do
    [[ "$c" == "$script" ]] && return 0
    for path in "${inputs[@]}"; do
      if [[ "$path" == */ ]]; then
        [[ "$c" == "$path"* ]] && return 0
      else
        [[ "$c" == "$path" ]] && return 0
      fi
    done
  done
  return 1
}

# The checks run side by side, as many at once as the machine has processors, or as
# CHECK_ALL_JOBS says; 1 runs them one after another. Each writes to a file of its own, and the
# files are printed in the order of the list below once all have finished, so the output reads as
# a run one after another would. A check therefore depends on no other and writes nowhere another
# reads: the self-tests build their fixtures in a directory of their own, and a run line added
# for a project's build keeps to the same. A runner stopped by a signal stops the checks it
# started and waits for them; what a check started in turn may outlive it.
max_jobs="${CHECK_ALL_JOBS:-$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
if [[ ! "$max_jobs" =~ ^[1-9][0-9]*$ ]]; then
  echo "check-all: CHECK_ALL_JOBS is '$max_jobs', not a number of checks from 1 up" >&2
  exit 2
fi
out="$(mktemp -d)"
labels=() kinds=() running=0
# stop — on every exit, a signal's included: stop the check of every job the runner still has, the
# one started an instant before included, wait for them, and remove their files. It sends the
# TERM to the check itself, never to the job's subshell, which traps nothing: a trap there is
# inherited by the check's process until its exec, and a TERM that reaches it in between is lost
# on the exec. Untrapped, a TERM before the exec ends that process before the check starts, and
# one after it reaches the check. The check's id is known once the subshell has written it, so
# stop() waits for it, or for the subshell to have ended.
# shellcheck disable=SC2317 # run by the trap
stop() {
  local job
  for job in $(jobs -p); do
    until [[ -e "$out/check.$job" ]] || ! kill -0 "$job" 2>/dev/null; do sleep 0.01; done
    [[ -e "$out/check.$job" ]] && kill "$(cat "$out/check.$job" 2>/dev/null)" 2>/dev/null
  done
  wait
  rm -rf "$out"
}
trap stop EXIT

# run <label> <script> [args...] — start one check, its output and exit code kept under $out. The
# subshell writes the check's id to check.<its own id> for stop(), at once by a rename, and
# removes it once the check has ended. Its last writes may find $out removed by stop(); what they
# would print then is dropped, and nothing else the subshell prints, such as a failed fork.
run() {
  local label="$1" script="$2" i="${#labels[@]}"
  shift 2
  labels+=("$label")
  kinds+=("$([[ "$script" == scripts/sensor-*.sh ]] && echo sensor || echo check)")
  if ((changed_mode)) && ! needs_run "$script"; then
    echo "skipped — neither it nor its inputs changed against main; CI runs it" > "$out/$i"
    echo 0 > "$out/$i.rc"
    return
  fi
  while ((running >= max_jobs)); do wait -n; running=$((running - 1)); done
  {
    bash "$ROOT/$script" "$@" > "$out/$i" 2>&1 &
    echo "$!" > "$out/new.$BASHPID" && mv "$out/new.$BASHPID" "$out/check.$BASHPID"
    wait "$!"
    rc=$?
    rm -f "$out/check.$BASHPID" 2>/dev/null
    echo "$rc" 2>/dev/null > "$out/$i.rc"
  } &
  running=$((running + 1))
}

run "Documentation self-test" scripts/test-check-docs.sh
run "Documentation consistency" scripts/check-docs.sh
run "Normalize map self-test" scripts/test-normalize-remap.sh
# The numbering script commits and runs on a human's instruction, before the pull request that
# brings drafts to main (ADR-0002); its self-test runs here.
# On instruction: scripts/number-adrs.sh
run "Numbering script self-test" scripts/test-number-adrs.sh
# The readiness script merges and commits on a human's instruction, as step 7 of
# Integration branches in CONTRIBUTING.md; its self-test runs here.
# On instruction: scripts/ready-for-main.sh
run "Readiness script self-test" scripts/test-ready-for-main.sh
# The drop script moves main and deletes a branch on a human's instruction, as step 8 of the
# Integration branches of CONTRIBUTING.md; its self-test runs here.
# On instruction: scripts/drop-merged-branch.sh
run "Drop script self-test" scripts/test-drop-merged-branch.sh
run "Plan modes self-test" scripts/test-check-plan-modes.sh
run "Plan modes" scripts/check-plan-modes.sh
run "Traceability self-test" scripts/test-check-traceability.sh
run "Traceability" scripts/check-traceability.sh
run "Dev Container self-test" scripts/test-check-devcontainer.sh
run "Dev Container" scripts/check-devcontainer.sh
run "Tests-kept sensor self-test" scripts/test-sensor-tests-kept.sh
run "Tests-kept sensor" scripts/sensor-tests-kept.sh
run "Binding ADRs sensor self-test" scripts/test-sensor-binding-adrs.sh
run "Binding ADRs sensor" scripts/sensor-binding-adrs.sh
run "Revision-due sensor self-test" scripts/test-sensor-revision-due.sh
run "Revision-due sensor" scripts/sensor-revision-due.sh
run "Plan frontier sensor self-test" scripts/test-sensor-plan-frontier.sh
run "Plan frontier sensor" scripts/sensor-plan-frontier.sh
run "Action references sensor self-test" scripts/test-sensor-action-refs.sh
# Verifies: ADR-0017 — every action is referenced by its full commit SHA.
run "Action references by commit SHA" scripts/sensor-action-refs.sh --require sha
run "Review binding sensor self-test" scripts/test-sensor-review-binding.sh
run "Review binding sensor" scripts/sensor-review-binding.sh
# The repository settings sensor reads GitHub and runs on a human's instruction (ADR-0002); its
# self-test runs here.
# On instruction: scripts/sensor-repo-settings.sh
run "Repository settings sensor self-test" scripts/test-sensor-repo-settings.sh
run "Check runner self-test" scripts/test-check-all.sh
run "Git hooks self-test" scripts/test-git-hooks.sh
run "Shell lint self-test" scripts/test-check-shell.sh
run "Shell lint" scripts/check-shell.sh
run "Structure self-test" scripts/test-check-structure.sh
run "Structure" scripts/check-structure.sh
run "Dependencies self-test" scripts/test-check-dependencies.sh
run "Dependencies" scripts/check-dependencies.sh
run "Container self-test" scripts/test-check-container.sh
run "Container" scripts/check-container.sh
run "Overview self-test" scripts/test-check-overview.sh
run "Overview" scripts/check-overview.sh
run "Comment width self-test" scripts/test-check-comment-width.sh
run "Comment width" scripts/check-comment-width.sh
run "Engine check self-test" scripts/test-check-engine.sh
run "Bundle check self-test" scripts/test-check-bundle.sh
# The comparison of surviving mutants reads the output of cargo-mutants, which the weekly
# Mutation testing workflow writes in about an hour; its self-test runs here.
# Not a gate: .github/workflows/mutation.yml
# On instruction: scripts/check-mutants.sh
run "Mutants check self-test" scripts/test-check-mutants.sh
# The build, the lint, and the tests, then the engine and bundle checks that read what the build
# wrote, one after another in this one line.
run "Build, test, lint" scripts/check-code.sh
# The weekly benchmark measures on a runner and compares with the baselines (ADR-0008); the Dev
# Container workflow builds the container, which needs a container engine the container lacks
# (ADR-0015).
# Not a gate: .github/workflows/benchmark.yml
# Not a gate: .github/workflows/devcontainer.yml

wait

failed=()
for i in "${!labels[@]}"; do
  if [[ "$(cat "$out/$i.rc" 2>/dev/null)" != 0 ]]; then
    failed+=("${labels[i]}")
  elif ((!verbose)) && [[ "${kinds[i]}" == check ]]; then
    last="$(grep -v '^[[:space:]]*$' "$out/$i" | tail -n 1)"
    printf 'ok: %s%s\n' "${labels[i]}" "${last:+ — $last}"
    grep -iE 'skip' "$out/$i" | grep -vxF -- "$last" | sed 's/^/    /'
    continue
  elif ((!verbose)); then
    first="$(grep -m1 -v '^[[:space:]]*$' "$out/$i")"
    more="$(grep -cv '^[[:space:]]*$' "$out/$i")"
    more=$((more - 1))
    printf 'sensor: %s%s%s\n' "${labels[i]}" "${first:+ — $first}" \
      "$( ((more > 0)) && echo " (+$more line$( ((more == 1)) || echo s); --verbose shows them)")"
    continue
  fi
  printf '\n==> %s\n' "${labels[i]}"
  cat "$out/$i"
done

printf '\n'
if ((${#failed[@]})); then
  echo "FAILED:" >&2
  printf '  - %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "All checks passed."
