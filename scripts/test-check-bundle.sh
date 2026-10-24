#!/usr/bin/env bash
#
# Self-test of scripts/check-bundle.sh. Verifies: Q-3, ADR-0019
#
# Each case writes a fixture bundle — JavaScript and WebAssembly files of known content — and runs
# the check against it with a small budget, asserting the exit code and the message. Random bytes
# do not compress, so their gzipped size is close to their size. A bundle that carries either seam
# of test mode fails naming it. The run without arguments is played in a fixture repository whose
# builds are stand-ins that write fixture bundles, too slow as they are for a self-test: it passes
# where both builds carry what they should, and fails where the build fails, where the package
# exports no engine file, where the build in test mode fails, where that build lacks either seam's
# mark, where the engine built in test mode lacks the trap, and where the two engines' glue
# differs. Verifies: ADR-0010, ADR-0021
#
# Usage:
#     scripts/test-check-bundle.sh
# Exit code 0 when every case passes, 1 otherwise.

# The single-quoted fixtures and stand-in builds are written as they stand, backquotes and $1 too.
# shellcheck disable=SC2016

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
echo 'throw new Error(`comb-test-mode:detaching: the memory cannot grow`);' > "$testing/comb.js"
head -c 100 /dev/urandom > "$testing/engine_bg.wasm"
expect fail "a bundle with the seam detaching alone fails naming it" "$testing" 10000 \
  "seam \`detaching\`"

trap="$work/trap"
mkdir -p "$trap"
echo 'export {};' > "$trap/comb.js"
{ head -c 100 /dev/urandom; printf 'comb_test_mode_trap'; } > "$trap/engine_bg.wasm"
expect fail "an engine with the trap of test mode fails" "$trap" 10000 "the engine's trap"

trapjs="$work/trap-js"
mkdir -p "$trapjs"
echo 'export const trap = (e) => e.comb_test_mode_trap();' > "$trapjs/comb.js"
head -c 100 /dev/urandom > "$trapjs/engine_bg.wasm"
expect fail "a bundle with the seam of the trap alone fails naming it" "$trapjs" 10000 \
  "the engine's trap"

empty="$work/empty"
mkdir -p "$empty"
expect fail "a directory without a bundle fails" "$empty" 10000 "no .js or .wasm"

# repository <name> — a fixture repository for the run without arguments: an engine check that
# passes, a package that exports its engine, the production engine and the one built in test
# mode, which names the trap, each with the same glue; printed as its path.
repository() {
  local dir="$work/$1"
  mkdir -p "$dir/scripts" "$dir/packages/comb/wasm/test-mode"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$dir/scripts/check-engine.sh"
  echo '{ "exports": { "./engine.wasm": "./wasm/engine_bg.wasm" } }' > "$dir/packages/comb/package.json"
  head -c 100 /dev/urandom > "$dir/packages/comb/wasm/engine_bg.wasm"
  { head -c 100 /dev/urandom; printf 'comb_test_mode_trap'; } \
    > "$dir/packages/comb/wasm/test-mode/engine_bg.wasm"
  echo 'export const glue = 1;' | tee "$dir/packages/comb/wasm/engine.js" \
    > "$dir/packages/comb/wasm/test-mode/engine.js"
  echo "$dir"
}

# A stand-in for each build: the library, and the library in test mode with both marks.
BUILT='mkdir -p packages/comb/dist && echo "export {};" > packages/comb/dist/comb.js'
TESTED='echo "const a = \`comb-test-mode:detaching\`, b = \"comb_test_mode_trap\";" > "$1/comb.js"'

# expect_run <pass|fail> <description> <repository> <pattern> [build [test build]] — run the
# check without arguments in a fixture repository.
expect_run() {
  local want="$1" desc="$2" repo="$3" pattern="$4" out rc
  out="$(CHECK_BUNDLE_ROOT="$repo" CHECK_BUNDLE_BUILD="${5:-$BUILT}" \
    CHECK_BUNDLE_TEST_BUILD="${6:-$TESTED}" bash "$CHECK" 2>&1)"; rc=$?
  if [[ ( "$want" == pass && $rc -eq 0 ) || ( "$want" == fail && $rc -eq 1 ) ]] \
    && [[ "$out" == *"$pattern"* ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "FAIL: $desc (expected $want, exit $rc)" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
  fi
}

expect_run pass "a run whose builds carry what they should passes" "$(repository full)" \
  "Bundle check passed"
expect_run fail "a build that fails" "$(repository broken)" "the build failed" "exit 1"
unexported="$(repository unexported)"
echo '{ "exports": {} }' > "$unexported/packages/comb/package.json"
expect_run fail "a package that exports no engine file" "$unexported" "exports no engine file"
expect_run fail "a build in test mode that fails" "$(repository test-broken)" \
  "the build in test mode failed" "$BUILT" "exit 1"
expect_run fail "a library in test mode without detaching's mark" "$(repository no-detaching)" \
  "does not recognise \`detaching\`" "$BUILT" 'echo "const b = \"comb_test_mode_trap\";" > "$1/comb.js"'
expect_run fail "a library in test mode without the trap's mark" "$(repository no-trap)" \
  "does not recognise the trap in the library" "$BUILT" \
  'echo "const a = \`comb-test-mode:detaching\`;" > "$1/comb.js"'
untrapped="$(repository untrapped)"
head -c 100 /dev/urandom > "$untrapped/packages/comb/wasm/test-mode/engine_bg.wasm"
expect_run fail "an engine built in test mode without the trap" "$untrapped" \
  "does not recognise the engine built in test mode"
glue="$(repository glue)"
echo 'export const glue = 2;' > "$glue/packages/comb/wasm/test-mode/engine.js"
expect_run fail "glue of the engine built in test mode that differs" "$glue" \
  "test-mode/engine.js differs from wasm/engine.js"

if ((failed)); then
  echo "Bundle check self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Bundle check self-test passed ($passed cases)."
