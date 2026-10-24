#!/usr/bin/env bash
#
# The overview names every entry point of Comb (ADR-0001, AGENTS.md §5).
#
# docs/ARCHITECTURE.md is believed, so a method a host application calls or a probe a test reads
# that it does not name is a part of the system a reader does not know is there. This check reads
# the names from the sources: each method and property of the `Comb` interface and each option of
# `CombOptions` in packages/comb/src/api/index.ts, and each function packages/comb/src/testing.ts
# exports, by declaration or by `export { … }`; and fails, naming each, where the overview holds no
# backquoted span with that name as a word in it. A stale sentence about a name it holds is review.
# The engine's buffer accessors stay out of it: the overview names the buffers, not each accessor.
#
# Usage:
#     scripts/check-overview.sh [repository root]
# The root defaults to this repository; scripts/test-check-overview.sh passes fixture trees.
# Exit code 0 when the overview names every entry point, 1 otherwise.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API="$ROOT/packages/comb/src/api/index.ts"
TESTING="$ROOT/packages/comb/src/testing.ts"
OVERVIEW="$ROOT/docs/ARCHITECTURE.md"

for file in "$API" "$TESTING" "$OVERVIEW"; do
  if [[ ! -f "$file" ]]; then
    echo "Overview check FAILED: ${file#"$ROOT/"} is missing, so nothing can be compared." >&2
    exit 1
  fi
done

# members <interface> — the names of the members of `export interface <interface> {` in the api,
# each at the interface's indentation of two spaces, a method or a property, read-only or not.
members() {
  awk -v open="export interface $1 {" '$0 == open { inside = 1; next } inside && /^}/ { exit }
    inside' "$API" | grep -oP '^  (readonly )?\K[A-Za-z_$][\w$]*(?=\??\s*[(:<])'
}

# exported — the functions testing.ts exports, by declaration or by name in `export { … }`.
exported() {
  grep -oP '^export (async )?function\s+\K[A-Za-z_$][\w$]*' "$TESTING"
  grep -oP '^export \{\K[^}]*(?=\})' "$TESTING" | tr ',' '\n' |
    sed -E 's/^[[:space:]]*(type[[:space:]]+)?//; s/[[:space:]].*$//' | grep -v '^$'
}

missing=()
check() {
  local what="$1" name
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    grep -qP "\`[^\`]*(?<![\\w\$])\Q$name\E(?![\\w\$])[^\`]*\`" "$OVERVIEW" || missing+=("$what \`$name\`")
  done
}

check "the Comb method or property" < <(members Comb | sort -u)
check "the CombOptions option" < <(members CombOptions | sort -u)
check "the comb/testing function" < <(exported | sort -u)

if ((${#missing[@]})); then
  echo "Overview check FAILED: docs/ARCHITECTURE.md names none of these in backquotes:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi
