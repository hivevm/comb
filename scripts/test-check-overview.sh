#!/usr/bin/env bash
#
# Self-test of scripts/check-overview.sh. Verifies: ADR-0001
#
# Each case builds a tree in a temporary directory with an api, a testing entry, and an overview,
# runs the check on it, and asserts the exit code and a line it prints. An overview that names
# every method, option, and testing function in backquotes passes and prints nothing; one that
# misses a method, an option, a declared testing function, or one exported by `export { … }` fails
# naming it; a renamed method fails naming the new name, though the old one is still in the
# overview; a name in the overview only as part of a longer word, or outside backquotes, counts as
# missing; a tree without one of the three files fails rather than pass.
#
# Usage:
#     scripts/test-check-overview.sh
# Exit code 0 when every case passes, 1 otherwise.

# The backquotes in single quotes are the overview's Markdown, meant to stay as written.
# shellcheck disable=SC2016

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-overview.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# tree <name> <method> <overview> — a tree whose Comb has `load` and <method>, whose options are
# `engine` and `canDelete`, whose testing entry exports `inspect` and, by name, `trapNextCall`, and
# whose overview is <overview>; printed as its path.
tree() {
  local dir="$work/$1"
  mkdir -p "$dir/packages/comb/src/api" "$dir/docs"
  cat > "$dir/packages/comb/src/api/index.ts" <<TS
export interface Comb {
  /** Replaces the graph. */
  load(graph: GraphData): void;
  readonly $2: (id: string) => void;
}

export interface CombOptions {
  engine: EngineSource;
  canDelete?: (deletion: Deletion) => unknown;
}
TS
  cat > "$dir/packages/comb/src/testing.ts" <<'TS'
export function inspect(comb: Comb): SceneSnapshot {
  return sceneOf(comb).inspect();
}
export { trapNextCall };
export type { SceneSnapshot };
TS
  printf '%s\n' "$3" > "$dir/docs/ARCHITECTURE.md"
  echo "$dir"
}

ALL='`load`, `select`, `engine`, and `CombOptions.canDelete`; `inspect(comb)` and `trapNextCall`.'

# expect <name> <exit code> <needle> <root> — run the check; it must exit with the code and print
# the needle, or print nothing when the needle is empty.
expect() {
  local name="$1" code="$2" needle="$3" root="$4"
  local out rc
  out="$(bash "$CHECK" "$root" 2>&1)"; rc=$?
  if ((rc == code)) && { [[ -z "$needle" && -z "$out" ]] || [[ -n "$needle" && "$out" == *"$needle"* ]]; }; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected exit $code with \"$needle\", exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

expect "every entry point named" 0 "" "$(tree named select "$ALL")"
expect "a method unnamed" 1 'Comb method or property `load`' \
  "$(tree no-method select "${ALL/\`load\`, /}")"
expect "an option unnamed" 1 'CombOptions option `canDelete`' \
  "$(tree no-option select "${ALL/ and \`CombOptions.canDelete\`/}")"
expect "a declared testing function unnamed" 1 'comb/testing function `inspect`' \
  "$(tree no-inspect select "${ALL/\`inspect(comb)\` and /}")"
expect "a testing function exported by name unnamed" 1 'comb/testing function `trapNextCall`' \
  "$(tree no-trap select "${ALL/ and \`trapNextCall\`/}")"
expect "a method renamed" 1 'Comb method or property `choose`' "$(tree renamed choose "$ALL")"
expect "a name only inside a longer word" 1 'Comb method or property `load`' \
  "$(tree longer select "${ALL/\`load\`/\`loaded\`}")"
expect "a name outside backquotes" 1 'Comb method or property `load`' \
  "$(tree bare select "${ALL/\`load\`/load}")"
missing="$(tree missing select "$ALL")"
rm "$missing/packages/comb/src/testing.ts"
expect "a tree without its testing entry" 1 "testing.ts is missing" "$missing"

if ((failed)); then
  echo "Overview check self-test: $passed passed, $failed failed." >&2
  exit 1
fi
echo "Overview check self-test: $passed passed, 0 failed."
