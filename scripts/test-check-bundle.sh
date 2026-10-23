#!/usr/bin/env bash
#
# Self-test of scripts/check-bundle.sh. Verifies: Q-3, ADR-0019
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
head -c 100 /dev/urandom > "$large/engine_bg.wasm"
expect fail "a bundle over the budget fails" "$large" 10000 "budget 10000"

maps="$work/maps"
mkdir -p "$maps"
head -c 50000 /dev/urandom > "$maps/comb.js.map"
echo 'export {};' > "$maps/comb.js"
head -c 100 /dev/urandom > "$maps/engine_bg.wasm"
expect pass "source maps do not count" "$maps" 10000 "in 2 files"

inline="$work/inline"
mkdir -p "$inline"
echo 'export const u = "data:application/wasm;base64,AGFzbQ==";' > "$inline/comb.js"
expect fail "a bundle that inlines the engine fails" "$inline" 10000 "inlines the engine"

both="$work/inline-and-file"
mkdir -p "$both"
echo 'export const u = "data:application/wasm;base64,AGFzbQ==";' > "$both/comb.js"
head -c 100 /dev/urandom > "$both/engine_bg.wasm"
expect fail "an inlined engine fails beside an engine file too" "$both" 10000 "inlines the engine"

base64="$work/base64"
mkdir -p "$base64"
echo 'const bytes = Uint8Array.from(atob("AGFzbQEAAAA="), (c) => c.charCodeAt(0));' > "$base64/comb.js"
head -c 100 /dev/urandom > "$base64/engine_bg.wasm"
expect fail "an engine inlined as base64 without a data URL fails" "$base64" 10000 "as base64"

script="$work/script-only"
mkdir -p "$script"
echo 'export {};' > "$script/comb.js"
expect fail "a bundle without the engine file fails" "$script" 10000 "no engine file"

testing="$work/test-mode"
mkdir -p "$testing"
echo 'throw new Error("Comb test mode: the engine'"'"'s memory cannot grow further");' > "$testing/comb.js"
head -c 100 /dev/urandom > "$testing/engine_bg.wasm"
expect fail "a bundle with the bridge's test mode fails" "$testing" 10000 "test mode"

trap="$work/trap"
mkdir -p "$trap"
echo 'export {};' > "$trap/comb.js"
{ head -c 100 /dev/urandom; printf 'comb_test_mode_trap'; } > "$trap/engine_bg.wasm"
expect fail "an engine with the trap of test mode fails" "$trap" 10000 "trap of test mode"

trapjs="$work/trap-js"
mkdir -p "$trapjs"
echo 'export const trap = (e) => e.comb_test_mode_trap();' > "$trapjs/comb.js"
head -c 100 /dev/urandom > "$trapjs/engine_bg.wasm"
expect fail "JavaScript that names the trap of test mode fails" "$trapjs" 10000 "trap of test mode"

empty="$work/empty"
mkdir -p "$empty"
expect fail "a directory without a bundle fails" "$empty" 10000 "no .js or .wasm"

if ((failed)); then
  echo "Bundle check self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Bundle check self-test passed ($passed cases)."
