#!/usr/bin/env bash
#
# Self-test of scripts/check-bundle.sh. Verifies: Q-3, ADR-0019
#
# Each case writes a fixture bundle — JavaScript and WebAssembly files of known content — and runs
# the check against it with a small budget, asserting the exit code and the message. Random bytes
# do not compress, so their gzipped size is close to their size. A bundle that carries either seam
# of test mode, by the marks the bridge's source names and this self-test reads as the check does,
# fails naming it. The run without arguments is played in a fixture repository whose builds are
# stand-ins that write fixture bundles, so that each fault can be put in where a real build would
# not make it: it passes where both builds carry what they should, and fails where the engine
# check fails, where the bridge names no marks, where the build fails, where the package has no
# package.json, exports no engine file or one that is missing, or names that export twice, where
# the build in test mode fails, where that build lacks either seam's mark, where the engine built
# in test mode lacks the trap, and where the two engines' glue is missing or differs. The cases of
# the trap and of the engine built in test mode verify ADR-0021, whose seam of test mode only they
# keep out of the shipped bundle; those of `detaching` hold the check's own rule and verify none.
# Verifies: ADR-0021
#
# Usage:
#     scripts/test-check-bundle.sh
# Exit code 0 when every case passes, 1 otherwise.

# The single-quoted fixtures and stand-in builds are written as they stand, $1 among them.
# shellcheck disable=SC2016

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-bundle.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# mark <constant> — the mark the bridge's source names, read as the check reads it.
mark() {
  sed -n "s/^const $1 = \"\([^\"]*\)\";\$/\1/p" "$ROOT/packages/comb/src/bridge/index.ts" | head -n 1
}
DETACHING="$(mark DETACHING_MARK)"
TRAP="$(mark TRAP_EXPORT)"

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
printf 'throw new Error(`%s: the memory cannot grow`);\n' "$DETACHING" > "$testing/comb.js"
head -c 100 /dev/urandom > "$testing/engine_bg.wasm"
expect fail "a bundle with the seam detaching alone fails naming it" "$testing" 10000 \
  "seam \`detaching\`"

trap="$work/trap"
mkdir -p "$trap"
echo 'export {};' > "$trap/comb.js"
{ head -c 100 /dev/urandom; printf '%s' "$TRAP"; } > "$trap/engine_bg.wasm"
expect fail "an engine with the trap of test mode fails" "$trap" 10000 "the engine's trap"

trapjs="$work/trap-js"
mkdir -p "$trapjs"
printf 'export const trap = (e) => e.%s();\n' "$TRAP" > "$trapjs/comb.js"
head -c 100 /dev/urandom > "$trapjs/engine_bg.wasm"
expect fail "a bundle with the seam of the trap alone fails naming it" "$trapjs" 10000 \
  "the engine's trap"

empty="$work/empty"
mkdir -p "$empty"
expect fail "a directory without a bundle fails" "$empty" 10000 "no .js or .wasm"

# repository <name> — a fixture repository for the run without arguments: an engine check that
# passes, a bridge that names both marks, a package that exports its engine, the production
# engine and the one built in test mode, which names the trap, each with the same glue; printed
# as its path.
repository() {
  local dir="$work/$1"
  mkdir -p "$dir/scripts" "$dir/packages/comb/wasm/test-mode" "$dir/packages/comb/src/bridge"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$dir/scripts/check-engine.sh"
  printf 'const DETACHING_MARK = "%s";\nconst TRAP_EXPORT = "%s";\n' "$DETACHING" "$TRAP" \
    > "$dir/packages/comb/src/bridge/index.ts"
  printf '{\n  "exports": {\n    ".": "./src/index.ts",\n    "./engine.wasm": "./wasm/engine_bg.wasm"\n  }\n}\n' \
    > "$dir/packages/comb/package.json"
  head -c 100 /dev/urandom > "$dir/packages/comb/wasm/engine_bg.wasm"
  { head -c 100 /dev/urandom; printf '%s' "$TRAP"; } \
    > "$dir/packages/comb/wasm/test-mode/engine_bg.wasm"
  echo 'export const glue = 1;' | tee "$dir/packages/comb/wasm/engine.js" \
    > "$dir/packages/comb/wasm/test-mode/engine.js"
  echo "$dir"
}

# writes <text> — a stand-in for the build in test mode that writes <text> as its bundle.
writes() { printf 'printf %%s %q > "$1/comb.js"' "$1"; }

# A stand-in for each build: the library, and the library in test mode with both marks.
BUILT='mkdir -p packages/comb/dist && echo "export {};" > packages/comb/dist/comb.js'
TESTED="$(writes "const a = \"$DETACHING\", b = \"$TRAP\";")"

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
stale="$(repository stale)"
printf '#!/usr/bin/env bash\necho "the engine is stale" >&2; exit 1\n' > "$stale/scripts/check-engine.sh"
expect_run fail "an engine check that fails" "$stale" "the engine is stale"
unmarked="$(repository unmarked)"
echo "export const TRAP_EXPORT = \"$TRAP\";" > "$unmarked/packages/comb/src/bridge/index.ts"
expect_run fail "a bridge that names no marks" "$unmarked" "holds no DETACHING_MARK or TRAP_EXPORT"
expect_run fail "a build that fails" "$(repository broken)" "the build failed" "exit 1"
unexported="$(repository unexported)"
echo '{ "exports": {} }' > "$unexported/packages/comb/package.json"
expect_run fail "a package that exports no engine file" "$unexported" "exports no engine file"
vanished="$(repository vanished)"
rm "$vanished/packages/comb/wasm/engine_bg.wasm"
expect_run fail "a package that exports an engine file that is missing" "$vanished" \
  "exports no engine file"
twice="$(repository twice)"
printf '{ "exports": {\n  "./engine.wasm": "./wasm/engine_bg.wasm",\n  "./engine.wasm": "./wasm/engine_bg.wasm"\n} }\n' \
  > "$twice/packages/comb/package.json"
expect_run fail "a package that names its engine's export twice" "$twice" "exports no engine file"
unpackaged="$(repository unpackaged)"
rm "$unpackaged/packages/comb/package.json"
expect_run fail "a package without package.json" "$unpackaged" "exports no engine file"
expect_run fail "a build in test mode that fails" "$(repository test-broken)" \
  "the build in test mode failed" "$BUILT" "exit 1"
expect_run fail "a library in test mode without detaching's mark" "$(repository no-detaching)" \
  "does not recognise \`detaching\`" "$BUILT" "$(writes "const b = \"$TRAP\";")"
expect_run fail "a library in test mode without the trap's mark" "$(repository no-trap)" \
  "does not recognise the trap in the library" "$BUILT" "$(writes "const a = \"$DETACHING\";")"
untrapped="$(repository untrapped)"
head -c 100 /dev/urandom > "$untrapped/packages/comb/wasm/test-mode/engine_bg.wasm"
expect_run fail "an engine built in test mode without the trap" "$untrapped" \
  "does not recognise the engine built in test mode"
glue="$(repository glue)"
echo 'export const glue = 2;' > "$glue/packages/comb/wasm/test-mode/engine.js"
expect_run fail "glue of the engine built in test mode that differs" "$glue" \
  "test-mode/engine.js differs from wasm/engine.js"
unglued="$(repository unglued)"
rm "$unglued/packages/comb/wasm/test-mode/engine.js"
expect_run fail "glue of the engine built in test mode that is missing" "$unglued" \
  "test-mode/engine.js is missing"

if ((failed)); then
  echo "Bundle check self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Bundle check self-test passed ($passed cases)."
