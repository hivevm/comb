#!/usr/bin/env bash
#
# Self-test of scripts/check-bundle.sh. Verifies: Q-3
#
# Each case writes a fixture bundle — JavaScript and WebAssembly files of known content — and runs
# the check against it with a small budget, asserting the exit code and the message. Random bytes
# do not compress, so their gzipped size is close to their size.
#
# Usage:
#     scripts/test-check-bundle.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-bundle.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# expect <pass|fail> <description> <dir> <budget> <pattern> — run the check on a directory.
expect() {
  local want="$1" desc="$2" dir="$3" budget="$4" pattern="$5" out rc
  out="$(bash "$CHECK" "$dir" "$budget" 2>&1)"; rc=$?
  if [[ ( "$want" == pass && $rc -eq 0 ) || ( "$want" == fail && $rc -eq 1 ) ]] \
    && [[ "$out" == *"$pattern"* ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "FAIL: $desc (expected $want, exit $rc)" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
  fi
}

small="$work/small"
mkdir -p "$small/assets"
printf 'export const x = 1;\n%.0s' {1..200} > "$small/comb.js"
head -c 2000 /dev/urandom > "$small/assets/engine_bg.wasm"
expect pass "a bundle under the budget passes" "$small" 10000 "in 2 files"

large="$work/large"
mkdir -p "$large"
head -c 12000 /dev/urandom > "$large/comb.js"
echo 'const u = "data:application/wasm;base64,AGFzbQ==";' >> "$large/comb.js"
expect fail "a bundle over the budget fails" "$large" 10000 "budget 10000"

inline="$work/inline"
mkdir -p "$inline"
head -c 50000 /dev/urandom > "$inline/comb.js.map"
echo 'export const u = "data:application/wasm;base64,AGFzbQ==";' > "$inline/comb.js"
expect pass "inlined WebAssembly counts; source maps do not" "$inline" 10000 "in 1 files"

script="$work/script-only"
mkdir -p "$script"
echo 'export {};' > "$script/comb.js"
expect fail "a bundle without WebAssembly fails" "$script" 10000 "no WebAssembly"

testing="$work/test-mode"
mkdir -p "$testing"
echo 'export const u = "data:application/wasm;base64,AGFzbQ==";' > "$testing/comb.js"
echo 'throw new Error("Comb test mode: the engine'"'"'s memory cannot grow further");' >> "$testing/comb.js"
expect fail "a bundle with the bridge's test mode fails" "$testing" 10000 "test mode"

empty="$work/empty"
mkdir -p "$empty"
expect fail "a directory without a bundle fails" "$empty" 10000 "no .js or .wasm"

if ((failed)); then
  echo "Bundle check self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Bundle check self-test passed ($passed cases)."
