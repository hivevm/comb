#!/usr/bin/env bash
#
# Self-test of scripts/sensor-superseded-citations.sh.
#
# Each case builds a throwaway git repository under a temporary directory with a record of its
# own under docs/adr/: an accepted ADR, a rejected one, and, where the case needs it, one that the
# accepted ADR supersedes. It writes the lines that cite them, runs the sensor against the
# repository, and asserts the exit code and the line the reviewer would read, or that a line is
# not reported. The numbers are the fixture's own, none of the tree's.
#
# Verifies: ADR-0002
# Inputs: scripts/sensor-superseded-citations.sh scripts/lib/
#
# Usage:
#     scripts/test-sensor-superseded-citations.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/selftest.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/selftest.sh"
SENSOR="$ROOT/scripts/sensor-superseded-citations.sh"
# The prefix of a citation, kept apart from the fixture's numbers so that check 5 of
# scripts/check-docs.sh does not read them as citations of this repository's record.
A=ADR-

# commit <dir> <message> — stage everything and commit with a fixed identity.
commit() {
  fixture "$1"
  git -C "${1:?}" add -A
  git -C "${1:?}" -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "$2"
}

# adr <dir> <number> <status> — an ADR file of the fixture's record with the given status line.
adr() {
  printf '# ADR-%s: A decision\n\n- **Status:** %s\n- **Date:** 2026-01-01\n\n## Context\n' \
    "$2" "$3" > "$1/docs/adr/$2-a-decision.md"
}

# repo <name> [superseded] — a repository with an accepted ADR 0902 and a rejected ADR 0903; with
# 'superseded', ADR 0901 too, superseded by 0902, which cites it in its own record. Printed as its
# path.
repo() {
  local dir="$work/$1"
  mkdir -p "$dir/docs/adr" "$dir/src"
  git -C "${dir:?}" init -q -b main
  adr "$dir" 0902 '🟢 accepted'
  adr "$dir" 0903 '🔴 rejected'
  if [[ "${2:-}" == superseded ]]; then
    adr "$dir" 0901 "⚪ superseded by [${A}0902](0902-a-decision.md)"
    printf '%s\n' "- **Supersedes:** [${A}0901](0901-a-decision.md)" \
      >> "$dir/docs/adr/0902-a-decision.md"
  fi
  printf 'print("app")\n' > "$dir/src/app.py"
  commit "$dir" "base"
  echo "$dir"
}

# expect <exit code> <name> <dir> <needle> [absent] — run the sensor on the repository; the
# output must contain the needle, and must not contain 'absent' where it is given.
expect() {
  local want="$1" name="$2" dir="$3" needle="$4" absent="${5-}"
  local out rc
  fixture "$dir"
  out="$(bash "$SENSOR" --root "$dir" 2>&1)"; rc=$?
  if [[ $rc -eq "$want" && "$out" == *"$needle"* && ( -z "$absent" || "$out" != *"$absent"* ) ]]
  then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected exit $want with \"$needle\"${absent:+ and without \"$absent\"}," \
    "got exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

# --- cases -----------------------------------------------------------------------------------

d="$(repo none-superseded)"
printf '%s\n' "# The core (${A}0902), not the rejected ${A}0903." >> "$d/src/app.py"
commit "$d" "cite an accepted and a rejected ADR"
expect 0 "a record with no superseded ADR reports nothing" "$d" "no ADR in docs/adr/ is superseded"

d="$(repo uncited superseded)"
expect 0 "a superseded ADR cited only in the record reports nothing" "$d" \
  "no line outside docs/adr/ cites ${A}0901"

d="$(repo cited superseded)"
printf '%s\n' "# The core (${A}0901)." >> "$d/src/app.py"
commit "$d" "cite the superseded ADR"
expect 0 "a citation outside the record, with its path, line, successor, and text" "$d" \
  "src/app.py:2: ${A}0901 (superseded by ${A}0902): # The core (${A}0901)."
expect 0 "the record's own citation is not reported" "$d" "1 citation(s)" "docs/adr/0902"

d="$(repo history superseded)"
printf '%s\n' "${A}0902 restates the superseded ${A}0901 with one more clause." > "$d/NOTES.md"
printf '%s\n' "    ${A}0901 for a rule" > "$d/src/rule.txt"
commit "$d" "a line of history and a line of a rule"
expect 0 "a line of history is reported too, since no script tells it from a rule" "$d" \
  "NOTES.md:1: ${A}0901 (superseded by ${A}0902): ${A}0902 restates the superseded ${A}0901"
expect 0 "the text is reported without its indentation" "$d" \
  "src/rule.txt:1: ${A}0901 (superseded by ${A}0902): ${A}0901 for a rule"
expect 0 "every citation is counted" "$d" "2 citation(s)"

d="$(repo other-numbers superseded)"
printf '%s\n' "${A}09010 and ${A}0902 and ${A}0903" > "$d/src/other.txt"
commit "$d" "numbers that are not the superseded ADR"
expect 0 "a longer number, an accepted ADR, and a rejected ADR are no citation of it" "$d" \
  "no line outside docs/adr/ cites ${A}0901"

d="$(repo untracked superseded)"
printf '%s\n' "${A}0901" > "$d/src/new.txt"
printf 'src/ignored.txt\n' > "$d/.gitignore"
printf '%s\n' "${A}0901" > "$d/src/ignored.txt"
expect 0 "a file not yet committed is read, an ignored one is not" "$d" \
  "src/new.txt:1: ${A}0901" "src/ignored.txt"

d="$(repo end-of-line superseded)"
printf '%s\n' "superseded by ${A}0901" > "$d/src/end.txt"
commit "$d" "a citation at the end of a line"
expect 0 "a citation at the end of a line" "$d" "src/end.txt:1: ${A}0901"

# A status line that names more than one ADR: the successor is the first it names.
d="$(repo two-named)"
adr "$d" 0901 \
  "⚪ superseded by [${A}0902](0902-a-decision.md), with [${A}0903](0903-a-decision.md)"
printf '%s\n' "${A}0901" > "$d/src/two.txt"
commit "$d" "a status line naming two ADRs"
expect 0 "the successor is the first ADR the status line names" "$d" \
  "src/two.txt:1: ${A}0901 (superseded by ${A}0902)"

# A binary file is no line a reviewer reads; git grep would report it as 'Binary file … matches'.
d="$(repo binary superseded)"
printf '%s\0\n' "${A}0901" > "$d/src/blob.bin"
commit "$d" "a binary file that holds the citation"
expect 0 "a binary file is not reported" "$d" "no line outside docs/adr/ cites ${A}0901" "blob.bin"

d="$work/no-record"
mkdir -p "$d" && git -C "$d" init -q -b main
expect 0 "a repository without docs/adr/ reports nothing" "$d" "no ADR in docs/adr/ is superseded"

# A directory git cannot read is no clean report: the sensor says it could not read it.
mkdir -p "$work/no-repository/docs/adr"
adr "$work/no-repository" 0901 "⚪ superseded by [${A}0902](0902-a-decision.md)"
printf '%s\n' "${A}0901" > "$work/no-repository/notes.txt"
out="$(GIT_CEILING_DIRECTORIES="$work" bash "$SENSOR" --root "$work/no-repository" 2>&1)"; rc=$?
check "a directory that is no git repository exits 2" [ "$rc" -eq 2 ]
check "a directory that is no git repository says it could not be read" \
  grep -q "could not read" <<< "$out"

out="$(bash "$SENSOR" --root "$work/missing" 2>&1)"; rc=$?
check "a --root that is no directory exits 2" [ "$rc" -eq 2 ]
check "a --root that is no directory says so" grep -q "is not a directory" <<< "$out"

# --- summary ---------------------------------------------------------------------------------

summary "Superseded citations sensor self-test"
