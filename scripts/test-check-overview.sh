#!/usr/bin/env bash
#
# Self-test of scripts/check-overview.sh. Verifies: ADR-0001
#
# Each case builds a tree in a temporary directory with an api, a testing entry, and an overview,
# runs the check on it, and asserts the exit code and a line it prints. An overview that names
# every method, option, and testing function passes and says so, a name after its qualifier or
# before its arguments and a span that wraps a line among them; one that misses a method, an
# option, a declared testing function, a `const` one, or one exported by name fails naming it; a
# renamed method fails naming the new name, though the old one is still in the overview; a name
# only inside a longer word, inside a path, outside a code span, in a fenced block, or in an HTML
# comment counts as missing. The sources may have an interface that extends another, carriage
# returns, a getter, comments between members, and an `export { … }` over lines that renames with
# `as` and holds a `type` specifier, which is left out. A source the check reads no names from
# fails rather than pass, and so does a tree without any one of the three files.
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

# tree <name> <method> <overview> [interface line] — a tree whose Comb has `load`, the getter
# `scale`, and <method>, opened by [interface line]; whose options are `engine` and `canDelete`;
# whose testing entry exports `inspect`, `probe` as a const, `trapNextCall` and `hit` (as
# `hitKind`) by name, and a type; and whose overview is <overview>; printed as its path.
tree() {
  local dir="$work/$1" opening="${4:-export interface Comb {}"
  mkdir -p "$dir/packages/comb/src/api" "$dir/docs"
  cat > "$dir/packages/comb/src/api/index.ts" <<TS
$opening
  /**
   * Replaces the graph.
   *  notAMember: in a comment
   */
  load(graph: GraphData): void;
  // other: a line comment
  get scale(): number;
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
export const probe = (comb: Comb) => sceneOf(comb).probe();
export const LIMIT = 4;
export {
  trapNextCall,
  hit as hitKind,
  type Hit,
};
export type { SceneSnapshot };
TS
  printf '%s\n' "$3" > "$dir/docs/ARCHITECTURE.md"
  echo "$dir"
}

ALL='`load`, `scale`, `select`, `engine`, and `CombOptions.canDelete`; `inspect(comb)`, `probe`,
`trapNextCall()`, and `hitKind`.'

# expect <name> <exit code> <needle> <root> — run the check; it must exit with the code and print
# the needle.
expect() {
  local name="$1" code="$2" needle="$3" root="$4"
  local out rc
  out="$(bash "$CHECK" "$root" 2>&1)"; rc=$?
  if ((rc == code)) && [[ "$out" == *"$needle"* ]]; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected exit $code with \"$needle\", exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

method='Comb method or property'
expect "every entry point named" 0 "Overview check passed (9 entry points named)" \
  "$(tree named select "$ALL")"
expect "a span that wraps a line" 0 "passed" \
  "$(tree wrapped select "${ALL/\`trapNextCall()\`/\`trapNextCall(
)\`}")"
expect "an interface that extends another, with carriage returns" 0 "passed (9 entry" \
  "$(tree extends select "$ALL" $'export interface Comb extends Base {\r')"
expect "a method unnamed" 1 "$method \`load\`" "$(tree no-method select "${ALL/\`load\`, /}")"
expect "a getter unnamed" 1 "$method \`scale\`" "$(tree no-getter select "${ALL/\`scale\`, /}")"
expect "an option unnamed" 1 'CombOptions option `canDelete`' \
  "$(tree no-option select "${ALL/ and \`CombOptions.canDelete\`/}")"
expect "a declared testing function unnamed" 1 'comb/testing function `inspect`' \
  "$(tree no-inspect select "${ALL/\`inspect(comb)\`, /}")"
expect "a const testing function unnamed" 1 'comb/testing function `probe`' \
  "$(tree no-probe select "${ALL/\`probe\`,/}")"
expect "a testing function exported by name unnamed" 1 'comb/testing function `trapNextCall`' \
  "$(tree no-trap select "${ALL/\`trapNextCall()\`, /}")"
expect "a function exported as another name, named by its own" 1 'comb/testing function `hitKind`' \
  "$(tree as-name select "${ALL/\`hitKind\`/\`hit\`}")"
expect "a method renamed" 1 "$method \`choose\`" "$(tree renamed choose "$ALL")"
expect "a name only inside a longer word" 1 "$method \`load\`" \
  "$(tree longer select "${ALL/\`load\`/\`loaded\`}")"
expect "a name only inside a path" 1 'CombOptions option `engine`' \
  "$(tree path select "${ALL/\`engine\`/\`crates/engine\`}")"
expect "a name outside a code span" 1 "$method \`load\`" "$(tree bare select "${ALL/\`load\`/load}")"
expect "a name only in a fenced block" 1 "$method \`load\`" \
  "$(tree fenced select "${ALL/\`load\`, /}
\`\`\`
\`load\`
\`\`\`")"
expect "a name only in an HTML comment" 1 "$method \`load\`" \
  "$(tree comment select "${ALL/\`load\`, /} <!-- \`load\` -->")"
expect "a source it reads no names from" 1 "read no $method" \
  "$(tree no-names select "$ALL" 'export interface Canvas {')"
for file in packages/comb/src/api/index.ts packages/comb/src/testing.ts docs/ARCHITECTURE.md; do
  missing="$(tree "missing-${file//\//-}" select "$ALL")"
  rm "$missing/$file"
  expect "a tree without $file" 1 "$file is missing" "$missing"
done

if ((failed)); then
  echo "Overview check self-test: $passed passed, $failed failed." >&2
  exit 1
fi
echo "Overview check self-test: $passed passed, 0 failed."
