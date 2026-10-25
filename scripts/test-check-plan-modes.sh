#!/usr/bin/env bash
#
# Self-test of scripts/check-plan-modes.sh.
#
# Each case builds a fixture under a temporary directory, a .github/CODEOWNERS and tickets under
# docs/plan/, runs the check against it, and asserts the exit code and, for a failing case, the
# message that names the ticket, the path, and the pattern. The cases cover an unattended ticket
# naming a protected path in its 'What to build' and in its 'Acceptance criteria', by a glob
# pattern and by a link relative to the ticket; the same path under 'Read first', inside an HTML
# comment, or in a ticket worked with the human; an unprotected path; a glob that does not cross a
# '/'; a CODEOWNERS with no pattern or none at all, and one whose last pattern has no final
# newline; a ticket that cannot be read; a ticket without a 'Mode', which the check leaves to the
# plan frontier sensor; and an unattended ticket with neither section the check reads.
#
# Usage:
#     scripts/test-check-plan-modes.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-plan-modes.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# tree <name> — a fixture with a CODEOWNERS of three protected patterns, printed as its path.
tree() {
  local dir="$work/$1"
  mkdir -p "$dir/.github" "$dir/docs/plan/s"
  printf '%s\n' \
    '# Protected parts.' \
    '' \
    '/crates/engine/src/graph/ @owner' \
    '/scripts/check-*.sh @owner' \
    '/.github/ @owner' > "$dir/.github/CODEOWNERS"
  echo "$dir"
}

# ticket <dir> <file> <mode> <what to build> [acceptance criteria] [read first] — write a ticket
# in the template's shape under docs/plan/s/.
ticket() {
  printf '# Ticket: fixture\n\n## What to build\n\n%s\n\n## Acceptance criteria\n\n- [ ] %s\n\n## Read first\n\n- %s\n\n## Blocked by\n\n- None (can start immediately)\n\n## Mode\n\n<!-- unattended only under AGENTS.md §4 -->\n\n%s\n' \
    "$4" "${5:-It works.}" "${6:-AGENTS.md}" "$3" > "$1/docs/plan/s/$2"
}

# expect <exit code> <name> <dir> [needles...] — run the check; its output must contain each needle.
expect() {
  local want="$1" name="$2" dir="$3"
  shift 3
  local out rc needle
  out="$(bash "$CHECK" "$dir" 2>&1)"; rc=$?
  local ok=1
  [[ $rc -eq "$want" ]] || ok=0
  for needle in "$@"; do [[ "$out" == *"$needle"* ]] || ok=0; done
  if ((ok)); then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected exit $want with: $*; got exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

GRAPH="crates/engine/src/graph/tests.rs"

# --- cases -----------------------------------------------------------------------------------

d="$(tree named)"
ticket "$d" 01-a.md "unattended: a test decides it" "Change \`$GRAPH\`."
expect 1 "an unattended ticket naming a protected path in What to build fails" "$d" \
  "docs/plan/s/01-a.md" "$GRAPH" "/crates/engine/src/graph/"

d="$(tree read-first)"
ticket "$d" 01-a.md "unattended: a test decides it" "Change the layout." "It works." "\`$GRAPH\`"
expect 0 "a protected path under Read first is not read" "$d" "1 ticket(s)" "1 unattended"

d="$(tree with-human)"
ticket "$d" 01-a.md "with the human: it touches the graph" "Change \`$GRAPH\`."
expect 0 "a ticket worked with the human may name a protected path" "$d" "1 ticket(s)"

d="$(tree comment)"
ticket "$d" 01-a.md "unattended" "Change the layout. <!-- not $GRAPH -->"
expect 0 "a protected path inside an HTML comment is not read" "$d" "1 ticket(s)" "1 unattended"

d="$(tree unprotected)"
ticket "$d" 01-a.md "unattended" "Change \`crates/engine/src/layout.rs\` and \`scripts/README.md\`."
expect 0 "an unattended ticket naming only unprotected paths passes" "$d" "1 ticket(s)" \
  "1 unattended"

d="$(tree glob)"
ticket "$d" 01-a.md "unattended" "Change the checks." "Given \`scripts/check-docs.sh\`, it fails."
expect 1 "a glob pattern covers a path the Acceptance criteria name" "$d" \
  "docs/plan/s/01-a.md" "scripts/check-docs.sh" "/scripts/check-*.sh"

d="$(tree glob-slash)"
ticket "$d" 01-a.md "unattended" "Change \`scripts/check-docs/notes.sh\`."
expect 0 "a '*' of a pattern does not cross a '/'" "$d" "1 ticket(s)"

d="$(tree link)"
ticket "$d" 01-a.md "unattended" "Edit [the workflow](../../../.github/workflows/checks.yml)."
expect 1 "a link relative to the ticket names the path it resolves to" "$d" \
  ".github/workflows/checks.yml" "/.github/"

d="$(tree no-pattern)"
printf '# Protected parts, none yet.\n\n' > "$d/.github/CODEOWNERS"
ticket "$d" 01-a.md "unattended" "Change the layout."
expect 1 "a CODEOWNERS with no pattern fails, naming it" "$d" ".github/CODEOWNERS"

d="$(tree no-file)"
rm "$d/.github/CODEOWNERS"
ticket "$d" 01-a.md "unattended" "Change the layout."
expect 1 "a missing CODEOWNERS fails, naming it" "$d" ".github/CODEOWNERS"

d="$(tree no-final-newline)"
printf '/crates/engine/src/graph/ @owner' > "$d/.github/CODEOWNERS"
ticket "$d" 01-a.md "unattended" "Change \`$GRAPH\`."
expect 1 "the last pattern of a CODEOWNERS without a final newline is read" "$d" \
  "$GRAPH" "/crates/engine/src/graph/"

d="$(tree unreadable)"
ticket "$d" 01-a.md "unattended" "Change the layout."
chmod 000 "$d/docs/plan/s/01-a.md"
expect 1 "a ticket that cannot be read fails, naming it" "$d" "docs/plan/s/01-a.md" "cannot be read"
chmod 644 "$d/docs/plan/s/01-a.md"

d="$(tree no-mode)"
printf '# Ticket: fixture\n\n## What to build\n\nChange %s.\n' "$GRAPH" > "$d/docs/plan/s/01-a.md"
expect 0 "a ticket without a Mode is left to the plan frontier sensor" "$d" "1 ticket(s)" \
  "0 unattended"

d="$(tree no-sections)"
printf '# Ticket: fixture\n\n## Work\n\nChange %s.\n\n## Mode\n\nunattended\n' "$GRAPH" \
  > "$d/docs/plan/s/01-a.md"
expect 1 "an unattended ticket with neither What to build nor Acceptance criteria fails" "$d" \
  "docs/plan/s/01-a.md" "a shape this check does not know"

d="$(tree empty)"
expect 0 "no ticket under docs/plan/ passes" "$d" "0 ticket(s)"

echo "check-plan-modes self-test: $passed passed, $failed failed."
((failed == 0))
