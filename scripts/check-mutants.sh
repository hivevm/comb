#!/usr/bin/env bash
#
# Mutation testing: compares the survivors of a cargo-mutants run with the recorded list
# (ADR-0008).
#
# cargo-mutants writes each mutant to a file of mutants.out by its outcome: missed.txt for the
# survivors, caught.txt, and timeout.txt for those whose tests ran past the timeout. Each line is
# '<file>:<line>:<column>: <description>', where the description ends in ' in <function>' for a
# mutant inside a function and is 'replace <function> [-> <type>] with <value>' for a replaced
# body. The line and the column move with every edit above the mutant, so this script keys each
# mutant by what does not move: '<file> <function> <replacement>', the replacement being the
# description without its ' in <function>'. Several survivors under one key are one entry with a
# count, written ' (xN)' after the key. The price of the key: within one function, a listed
# survivor now caught and a new survivor under the same key leave the count as it was, and pass.
#
# The run fails when it has more survivors under a key than the list names, and names each such
# key with the places the run found it; it fails too when the run caught no mutant at all, which
# is a run that tested nothing. A key the list names more often than the run misses is reported
# and fails nothing: as timed out, not caught, for the mutants under it that timed out, and as now
# caught, so the list can shrink, for the rest. A line this script cannot read fails the run,
# since a changed format would otherwise pass every survivor.
#
# Pure bash. Usage:
#     scripts/check-mutants.sh <mutants.out> <list>    compare with the list
#     scripts/check-mutants.sh --record <mutants.out>  print a list recorded from the run
# The workflow passes mutants.out and crates/engine/mutants-missed.txt.
# Exit code 0 when no survivor is new, 1 when one is or none was caught, 2 when an input cannot be
# read.

set -uo pipefail

usage() {
  echo "Usage: scripts/check-mutants.sh <mutants.out> <list> | --record <mutants.out>" >&2
  exit 2
}

record=0
if [[ "${1:-}" == "--record" ]]; then
  record=1
  shift
  (($# == 1)) || usage
else
  (($# == 2)) || usage
fi
out="$1"
list="${2:-}"
for f in missed caught timeout; do
  [[ -f "$out/$f.txt" ]] || { echo "Mutants check: '$out/$f.txt' is not a file." >&2; exit 2; }
done
[[ -n "$list" && ! -f "$list" ]] && { echo "Mutants check: '$list' is not a file." >&2; exit 2; }

declare -A run_count=() run_places=() timeout_count=() list_count=()

# key_of <description> — the function and replacement of a mutant's description, printed as
# '<function> <replacement>'; fails when the description has neither form.
key_of() {
  local desc="$1" fn
  if [[ "$desc" =~ ^(.+)\ in\ ([^[:space:]].*)$ ]]; then
    printf '%s %s' "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}"
  elif [[ "$desc" == "replace "*" with "* ]]; then
    fn="${desc#replace }"
    fn="${fn%% with *}"
    fn="${fn%% -> *}"
    printf '%s %s' "$fn" "$desc"
  else
    return 1
  fi
}

caught=0

# read_outcome <file> <outcome> — count each mutant of the file under its key, as missed (with its
# place), timeout, or caught; exits with 2 on a line it cannot read.
read_outcome() {
  local file="$1" outcome="$2" line key n=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    [[ -z "${line//[[:space:]]/}" ]] && continue
    if [[ "$line" =~ ^([^:]+):([0-9]+):([0-9]+):\ (.+)$ ]] \
      && key="$(key_of "${BASH_REMATCH[4]}")"; then
      key="${BASH_REMATCH[1]} $key"
      case "$outcome" in
        missed)
          run_count["$key"]=$((${run_count["$key"]:-0} + 1))
          run_places["$key"]+=" ${BASH_REMATCH[1]}:${BASH_REMATCH[2]}:${BASH_REMATCH[3]}"
          ;;
        timeout) timeout_count["$key"]=$((${timeout_count["$key"]:-0} + 1)) ;;
        caught) caught=$((caught + 1)) ;;
      esac
    else
      echo "Mutants check: $file:$n: cannot read '$line' as '<file>:<line>:<column>: <mutant>'." >&2
      exit 2
    fi
  done < "$file"
}

read_outcome "$out/missed.txt" missed
read_outcome "$out/timeout.txt" timeout
read_outcome "$out/caught.txt" caught

# entry <key> <count> — a key as the list writes it.
entry() { if (($2 > 1)); then printf '%s (x%d)\n' "$1" "$2"; else printf '%s\n' "$1"; fi; }

if ((record)); then
  echo "# Surviving mutants of crates/engine that the mutation workflow accepts (ADR-0008)."
  echo "# One per line as '<file> <function> <replacement>', ' (xN)' when one key covers N mutants."
  echo "# Recorded with scripts/check-mutants.sh --record; the README says how the list changes."
  for key in "${!run_count[@]}"; do entry "$key" "${run_count[$key]}"; done | LC_ALL=C sort
  exit 0
fi

n=0
while IFS= read -r line || [[ -n "$line" ]]; do
  n=$((n + 1))
  [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
  count=1
  if [[ "$line" =~ ^(.+)\ \(x([0-9]+)\)$ ]]; then
    line="${BASH_REMATCH[1]}"
    count="${BASH_REMATCH[2]}"
  fi
  list_count["$line"]=$((${list_count["$line"]:-0} + count))
done < "$list"

new=() shrink=() timed=()
for key in "${!run_count[@]}"; do
  have="${run_count[$key]}" listed="${list_count[$key]:-0}"
  ((have > listed)) \
    && new+=("$key — $((have - listed)) new of $have missed, at${run_places[$key]}")
done
for key in "${!list_count[@]}"; do
  have="${run_count[$key]:-0}" listed="${list_count[$key]}"
  ((have < listed)) || continue
  gone=$((listed - have)) slow="${timeout_count[$key]:-0}"
  ((slow > gone)) && slow=$gone
  ((slow > 0)) && timed+=("$key — listed $listed, missed $have, timed out $slow")
  ((gone > slow)) && shrink+=("$key — listed $listed, missed $have")
done

total=0
for key in "${!run_count[@]}"; do total=$((total + run_count[$key])); done

# report <stream> <heading> <line...> — a heading and its lines, sorted, when there are any.
report() {
  local fd="$1" heading="$2"; shift 2
  (($#)) || return 0
  { echo "$heading"; printf '%s\n' "$@" | LC_ALL=C sort | sed 's/^/  - /'; } >&"$fd"
}
report 1 \
  "Mutants check: ${#timed[@]} listed survivor(s) timed out, not caught — keep them listed:" \
  "${timed[@]}"
report 1 "Mutants check: ${#shrink[@]} listed survivor(s) now caught — shrink the list:" \
  "${shrink[@]}"
status=0
if ((caught == 0)); then
  echo "Mutants check: the run caught no mutant — it tested nothing." >&2
  status=1
fi
if ((${#new[@]})); then
  report 2 "Mutants check: ${#new[@]} survivor(s) the list does not name:" "${new[@]}"
  status=1
fi
((status == 0)) && echo "Mutants check: $total survivor(s), every one named by the list."
exit "$status"
