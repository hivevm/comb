#!/usr/bin/env bash
#
# Self-test of scripts/check-mutants.sh. Verifies: ADR-0008
#
# Each case writes a mutants.out in cargo-mutants' format and a list, runs the comparison, and
# asserts the exit code and a line it prints. The run that matches the list passes; a run that
# moved the lines of its survivors still matches; a survivor the list lacks, and one more mutant
# under a listed key, fail and are named; a listed survivor the run no longer misses is reported
# as now caught, or as timed out when it timed out, and fails nothing; a run that caught nothing
# fails; within one function, a caught and a new survivor under one key pass, the price of the
# key; a line the script cannot read, and a missing file, fail rather than pass.
#
# Usage:
#     scripts/test-check-mutants.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-mutants.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

SRC=crates/engine/src
CAUGHT="$SRC/geometry.rs:54:9: replace Rect::meets -> bool with true"

# run <name> <missed> [timeout] [caught] — a mutants.out whose three files hold the given lines,
# one string of lines each, printed as its path. Unless given, one mutant was caught and none
# timed out.
run() {
  local dir="$work/$1/mutants.out"
  mkdir -p "$dir"
  printf '%s\n' "$2" > "$dir/missed.txt"
  printf '%s\n' "${3:-}" > "$dir/timeout.txt"
  printf '%s\n' "${4-$CAUGHT}" > "$dir/caught.txt"
  echo "$dir"
}

# lines <line...> — the lines as one string.
lines() { printf '%s\n' "$@"; }

# expect <name> <exit code> <needle> <args...> — run the check; it must exit with the code and
# print the needle.
expect() {
  local name="$1" code="$2" needle="$3"; shift 3
  local out rc
  out="$(bash "$CHECK" "$@" 2>&1)"; rc=$?
  if ((rc == code)) && [[ "$out" == *"$needle"* ]]; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected exit $code with \"$needle\", exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

SUB1="$SRC/stroke.rs:42:15: replace + with * in subdivide"
SUB2="$SRC/stroke.rs:57:15: replace + with * in subdivide"
BODY="$SRC/graph.rs:186:9: replace Graph::cell_side -> f64 with 0.0"
DEL="$SRC/geometry.rs:112:37: delete - in extrema"

# The run the list is recorded from: two mutants under one key, a replaced body, a deletion.
recorded="$(run recorded "$(lines "$SUB1" "$SUB2" "$BODY" "$DEL")")"
list="$work/list.txt"
lines "# Surviving mutants." "" \
  "$SRC/geometry.rs extrema delete -" \
  "$SRC/graph.rs Graph::cell_side replace Graph::cell_side -> f64 with 0.0" \
  "$SRC/stroke.rs subdivide replace + with * (x2)" > "$list"

expect "the run the list names passes" 0 "4 survivor(s), every one named by the list" \
  "$recorded" "$list"

expect "the recorded list keys each survivor by file, function, and replacement" 0 \
  "$SRC/stroke.rs subdivide replace + with * (x2)" --record "$recorded"

relisted="$work/relisted.txt"
bash "$CHECK" --record "$recorded" > "$relisted"
expect "the run passes against the list recorded from it" 0 "every one named by the list" \
  "$recorded" "$relisted"

# An edit above the survivors moved every line and column; the keys stay.
moved="$(run moved "$(lines \
  "$SRC/stroke.rs:49:19: replace + with * in subdivide" \
  "$SRC/stroke.rs:64:19: replace + with * in subdivide" \
  "$SRC/graph.rs:203:9: replace Graph::cell_side -> f64 with 0.0" \
  "$SRC/geometry.rs:118:37: delete - in extrema")")"
expect "an edit that moved the lines still matches each survivor" 0 \
  "4 survivor(s), every one named by the list" "$moved" "$list"

new="$(run new "$(lines "$SUB1" "$SUB2" "$BODY" "$DEL" \
  "$SRC/geometry.rs:113:20: replace < with <= in extrema")")"
expect "a survivor the list lacks fails and is named with its place" 1 \
  "$SRC/geometry.rs extrema replace < with <= — 1 new of 1 missed, at $SRC/geometry.rs:113:20" \
  "$new" "$list"

third="$(run third "$(lines "$SUB1" "$SUB2" "$SRC/stroke.rs:71:15: replace + with * in subdivide" \
  "$BODY" "$DEL")")"
expect "a third mutant under a key listed twice fails" 1 \
  "$SRC/stroke.rs subdivide replace + with * — 1 new of 3 missed" "$third" "$list"

other="$(run other "$(lines "$SUB1" "$SUB2" \
  "$SRC/graph.rs:186:9: replace Graph::cell_side -> f64 with 1.0" "$DEL")")"
expect "another replacement in a listed function is a new survivor" 1 \
  "$SRC/graph.rs Graph::cell_side replace Graph::cell_side -> f64 with 1.0 — 1 new of 1 missed" \
  "$other" "$list"

# The price of the key: the survivor at 42 is caught, one at 88 in the same function is new.
traded="$(run traded "$(lines "$SUB2" "$SRC/stroke.rs:88:15: replace + with * in subdivide" \
  "$BODY" "$DEL")")"
expect "a caught and a new survivor under one key in one function pass" 0 \
  "4 survivor(s), every one named by the list" "$traded" "$list"

killed="$(run killed "$(lines "$SUB1" "$BODY")")"
expect "a listed survivor now caught is reported and passes" 0 \
  "$SRC/stroke.rs subdivide replace + with * — listed 2, missed 1" "$killed" "$list"
expect "a listed survivor no longer missed at all is reported" 0 \
  "$SRC/geometry.rs extrema delete - — listed 1, missed 0" "$killed" "$list"

slow="$(run slow "$(lines "$SUB1" "$BODY")" "$SRC/stroke.rs:57:15: replace + with * in subdivide")"
expect "a listed survivor that timed out is reported as timed out, not caught" 0 \
  "timed out, not caught — keep them listed:
  - $SRC/stroke.rs subdivide replace + with * — listed 2, missed 1, timed out 1" "$slow" "$list"
out="$(bash "$CHECK" "$slow" "$list" 2>&1)"
if [[ "$out" == *"subdivide replace + with * — listed 2, missed 1"$'\n'* ]]; then
  failed=$((failed + 1))
  echo "FAIL: a listed survivor that timed out is not offered for shrinking" >&2
else
  passed=$((passed + 1))
fi

stalled="$(run stalled "" "$(lines "$SUB1" "$SUB2" "$BODY" "$DEL")" "")"
expect "a run that caught nothing fails even when everything timed out" 1 \
  "the run caught no mutant — it tested nothing" "$stalled" "$list"

empty="$(run empty "")"
expect "a run without survivors passes" 0 "0 survivor(s)" "$empty" "$list"

# Names as cargo-mutants writes them for impls, trait methods, and match arms and guards.
FMT="<impl Display for Foo<T>>::fmt"
names="$(run names "$(lines \
  "$SRC/view.rs:12:9: replace $FMT -> fmt::Result with Ok(Default::default())" \
  "$SRC/view.rs:14:20: replace == with != in $FMT" \
  "$SRC/view.rs:30:9: replace <impl Shape for Rect>::area -> f64 with 0.0" \
  "$SRC/view.rs:41:13: replace match guard x > 0.0 with true in classify" \
  "$SRC/view.rs:43:13: delete match arm None in classify")")"
expect "an impl's body replacement keys by the impl's function" 0 \
  "$SRC/view.rs $FMT replace $FMT -> fmt::Result with Ok(Default::default())" --record "$names"
expect "an operator in an impl's function keys by that function" 0 \
  "$SRC/view.rs $FMT replace == with !=" --record "$names"
expect "a trait method keys by its impl" 0 \
  "$SRC/view.rs <impl Shape for Rect>::area replace <impl Shape for Rect>::area -> f64 with 0.0" \
  --record "$names"
expect "a match guard keys by its function" 0 \
  "$SRC/view.rs classify replace match guard x > 0.0 with true" --record "$names"
expect "a match arm keys by its function" 0 \
  "$SRC/view.rs classify delete match arm None" --record "$names"
named="$work/named.txt"
bash "$CHECK" --record "$names" > "$named"
expect "a run passes against the list of such names recorded from it" 0 \
  "5 survivor(s), every one named by the list" "$names" "$named"

broken="$(run broken "$SRC/stroke.rs: replace + with * in subdivide")"
expect "a line without its line and column cannot be read" 2 "missed.txt:1: cannot read" \
  "$broken" "$list"

odd="$(run odd "" "$SRC/stroke.rs:42:15: swap the arguments")"
expect "a mutant of neither form cannot be read" 2 "timeout.txt:1: cannot read" "$odd" "$list"

absent="$(run absent "$SUB1")"
rm "$absent/missed.txt"
expect "a run without missed.txt cannot be read" 2 "missed.txt' is not a file" "$absent" "$list"

expect "a missing list cannot be read" 2 "is not a file" "$recorded" "$work/absent.txt"

echo "Mutants check self-test: $passed passed, $failed failed."
((failed == 0))
