#!/usr/bin/env bash
#
# Self-test of scripts/check-engine.sh. Verifies: ADR-0008
#
# Each case builds a tree in a temporary directory with sources under crates/, Cargo.toml,
# Cargo.lock, and the two engine files, sets their times, runs the check on it, and asserts the
# exit code and a line it prints. A fresh build passes and prints nothing; an engine file older
# than a source under crates/, than Cargo.toml, or than Cargo.lock fails, naming the file, the
# source, and `bun run build:engine`, for the engine and for the engine built in test mode alike;
# a missing engine file and a missing engine directory fail with the same advice; a root without
# the sources fails rather than pass.
#
# Usage:
#     scripts/test-check-engine.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-engine.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

ENGINE=packages/comb/wasm/engine_bg.wasm
TESTING=packages/comb/wasm/test-mode/engine_bg.wasm
SOURCE=crates/engine/src/stroke.rs

# tree <name> — a fresh build: every source at noon, both engine files an hour later; printed as
# its path.
tree() {
  local dir="$work/$1" file
  mkdir -p "$dir/crates/engine/src" "$dir/packages/comb/wasm/test-mode"
  for file in "$SOURCE" crates/engine/Cargo.toml Cargo.toml Cargo.lock "$ENGINE" "$TESTING"; do
    : > "$dir/$file"
  done
  touch -d '2026-01-01 12:00' "$dir/$SOURCE" "$dir/crates/engine/Cargo.toml" "$dir/Cargo.toml" \
    "$dir/Cargo.lock"
  touch -d '2026-01-01 13:00' "$dir/$ENGINE" "$dir/$TESTING"
  echo "$dir"
}

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

expect "a fresh build passes silently" 0 "" "$(tree fresh)"

stale="$(tree stale)"
touch -d '2026-01-01 14:00' "$stale/$SOURCE"
expect "an engine older than a source of crates/ fails, naming both and the command" 1 \
  "$ENGINE is older than $SOURCE — run \`bun run build:engine\`" "$stale"
expect "the engine built in test mode is checked too" 1 \
  "$TESTING is older than $SOURCE — run \`bun run build:engine\`" "$stale"

testing="$(tree testing)"
touch -d '2026-01-01 12:30' "$testing/$TESTING"
touch -d '2026-01-01 12:45' "$testing/$SOURCE"
expect "a stale engine of test mode alone fails" 1 "$TESTING is older than $SOURCE" "$testing"

manifest="$(tree manifest)"
touch -d '2026-01-01 14:00' "$manifest/crates/engine/Cargo.toml"
expect "a crate's manifest is a source" 1 "is older than crates/engine/Cargo.toml" "$manifest"

workspace="$(tree workspace)"
touch -d '2026-01-01 14:00' "$workspace/Cargo.toml"
expect "the workspace's Cargo.toml is a source" 1 "is older than Cargo.toml" "$workspace"

lock="$(tree lock)"
touch -d '2026-01-01 14:00' "$lock/Cargo.lock"
expect "Cargo.lock is a source" 1 "is older than Cargo.lock" "$lock"

added="$(tree added)"
: > "$added/crates/engine/src/new.rs"
expect "a source added after the build fails" 1 "is older than crates/engine/src/new.rs" "$added"

file="$(tree file)"
rm "$file/$TESTING"
expect "a missing engine file fails with the advice" 1 \
  "$TESTING is missing — run \`bun run build:engine\`" "$file"

directory="$(tree directory)"
rm -r "$directory/packages/comb/wasm"
expect "a missing engine directory fails with the advice" 1 \
  "$ENGINE is missing — run \`bun run build:engine\`" "$directory"

expect "a root without the sources fails" 1 "holds no crates/" "$work/directory/packages"

echo "Engine check self-test: $passed passed, $failed failed."
((failed == 0))
