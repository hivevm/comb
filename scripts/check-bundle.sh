#!/usr/bin/env bash
#
# Bundle budget of the library (ADR-0008). Verifies: Q-3
#
# Q-3 keeps the library bundle — Comb's JavaScript and WebAssembly, gzipped, without PixiJS —
# under 300 kB. Without arguments this builds the bundle with `bun run build:lib` into
# packages/comb/dist and measures its .js files and the engine file `comb` exports as
# `comb/engine.wasm`; with a directory it measures the .js and .wasm files there, which is how
# scripts/test-check-bundle.sh passes fixtures. Each file is gzipped at level 9 and the sizes are
# summed; 1 kB is 1,000 bytes.
#
# The host application hands Comb the engine (ADR-0019), so the bundle carries it as a .wasm file
# of its own and never inlined in the JavaScript: the check fails on a missing engine file, since a
# bundle of JavaScript alone would pass while measuring less than Q-3 means, and on an inlined one,
# as a data URL or as any base64 that begins with the WebAssembly magic number (`AGFzbQ`).
# Verifies: ADR-0019
#
# Nor may the bundle carry either seam of the bridge's test mode, which only tests run in: the
# memory grown before every call of the engine (`detaching`), and the trap the engine exports in
# test mode, which the bridge looks up. ADR-0021 decides the trap a seam of test mode only;
# keeping `detaching` out is the check's own rule, which no ADR decides. Each has a mark of its
# own, which the check reads from packages/comb/src/bridge/index.ts, `DETACHING_MARK` and
# `TRAP_EXPORT`: a .js file that carries either, or a file that names the trap's export, fails,
# naming the seam.
# Without arguments the check also builds the library in Vite's test mode and fails unless it
# finds each mark in that bundle, and the trap's in the engine built in test mode,
# packages/comb/wasm/test-mode/engine_bg.wasm, so a changed mark turns it red rather than blind;
# and it fails where the glue generated for that engine, wasm/test-mode/engine.js, differs from
# the production engine's, wasm/engine.js, which the example hands over beside it.
# Verifies: ADR-0021
#
# Without arguments it measures the engine of packages/comb/wasm/, so it first runs
# scripts/check-engine.sh and fails on an engine older than its sources.
#
# Usage:
#     scripts/check-bundle.sh [directory [budget in bytes]]
# Exit code 0 when the bundle is under the budget, 1 otherwise. For its self-test, a run without
# arguments takes the repository root, whose bridge's source names the marks, from
# CHECK_BUNDLE_ROOT, and the commands that build the
# library and the library in test mode, run there, from CHECK_BUNDLE_BUILD and
# CHECK_BUNDLE_TEST_BUILD, the second handed the directory to build into as $1.

set -uo pipefail

ROOT="${CHECK_BUNDLE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BUDGET="${2:-300000}"
BUILD="${CHECK_BUNDLE_BUILD:-bun run build:lib > /dev/null}"
TEST_BUILD="${CHECK_BUNDLE_TEST_BUILD:-cd packages/comb && bunx --bun vite build --mode test --outDir \"\$1\" > /dev/null}"

# mark <constant> — the string the bridge's source assigns to <constant>.
mark() {
  sed -n "s/^const $1 = \"\([^\"]*\)\";\$/\1/p" "$ROOT/packages/comb/src/bridge/index.ts" | head -n 1
}
DETACHING="$(mark DETACHING_MARK)"
TRAP="$(mark TRAP_EXPORT)"
if [[ -z "$DETACHING" || -z "$TRAP" ]]; then
  echo "Bundle check FAILED: packages/comb/src/bridge/index.ts holds no DETACHING_MARK or TRAP_EXPORT." >&2
  exit 1
fi

files=()
if (($# == 0)); then
  bash "$ROOT/scripts/check-engine.sh" || exit 1
  (cd "$ROOT" && bash -c "$BUILD") || { echo "Bundle check: the build failed." >&2; exit 1; }
  dir="$ROOT/packages/comb/dist"
  package="$ROOT/packages/comb"
  # The export is read without a JSON parser, so the self-test runs where no Bun is installed: the
  # one plain string the top-level `exports` object maps "./engine.wasm" to, key and value on one
  # line. A key named twice, a value that is not a plain string, a key and value on separate
  # lines, the key outside `exports`, or an unreadable file reads as no export.
  mapfile -t engines < <(awk '
    {
      n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (c == "\"") {
          for (j = i + 1; j <= n && substr($0, j, 1) != "\""; j++)
            if (substr($0, j, 1) == "\\") j++
          token = substr($0, i + 1, j - i - 1)
          rest = substr($0, j + 1)
          if (rest ~ /^[ \t]*:/) key[depth] = token
          if (exports && depth == 2 && token == "./engine.wasm" \
            && match(rest, /^[ \t]*:[ \t]*"[^"\\]*"/)) {
            value = substr(rest, 1, RLENGTH)
            sub(/.*:[ \t]*"/, "", value)
            print substr(value, 1, length(value) - 1)
          }
          i = j
        } else if (c == "{" || c == "[") {
          if (c == "{" && depth == 1 && key[1] == "exports") exports = 1
          depth++
        } else if (c == "}" || c == "]") {
          depth--
          if (depth == 1) exports = 0
          delete key[depth + 1]
        }
      }
    }' "$package/package.json" 2> /dev/null)
  engine="${engines[0]:-}"
  if ((${#engines[@]} != 1)) || [[ -z "$engine" || ! -f "$package/$engine" ]]; then
    echo "Bundle check FAILED: packages/comb/package.json exports no engine file as ./engine.wasm that exists (ADR-0019)." >&2
    exit 1
  fi
  files+=("$package/$engine")
else
  dir="$1"
fi
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(find "$dir" -type f \( -name '*.js' -o -name '*.wasm' \) -print0)

total=0
count=0
wasm=0
for file in "${files[@]}"; do
  size="$(gzip -9 -c "$file" | wc -c)"
  total=$((total + size))
  count=$((count + 1))
  [[ "$file" == *.wasm ]] && wasm=$((wasm + 1))
done

if ((count == 0)); then
  echo "Bundle check FAILED: no .js or .wasm file in $dir." >&2
  exit 1
fi
if grep -rqs --include='*.js' 'data:application/wasm' "$dir"; then
  echo "Bundle check FAILED: the JavaScript in $dir inlines the engine as a data URL (ADR-0019)." >&2
  exit 1
fi
if grep -rqs --include='*.js' 'AGFzbQ' "$dir"; then
  echo "Bundle check FAILED: the JavaScript in $dir inlines the engine as base64 (ADR-0019)." >&2
  exit 1
fi
if ((wasm == 0)); then
  echo "Bundle check FAILED: no engine file, no .wasm among the files measured (Q-3)." >&2
  exit 1
fi
if grep -rqsF --include='*.js' "$DETACHING" "$dir"; then
  echo "Bundle check FAILED: the bundle carries the test mode's seam \`detaching\` (the check's own rule)." >&2
  exit 1
fi
# carries_trap <file>... — whether any of the files names the export of the engine's trap.
carries_trap() {
  local file
  for file in "$@"; do
    grep -qsaF "$TRAP" "$file" && return 0
  done
  return 1
}
if carries_trap "${files[@]}"; then
  echo "Bundle check FAILED: the bundle carries the test mode's seam, the engine's trap (ADR-0021)." >&2
  exit 1
fi
if ((total >= BUDGET)); then
  echo "Bundle check FAILED: $total bytes gzipped in $count files, budget $BUDGET (Q-3)." >&2
  exit 1
fi
if (($# == 0)); then
  testing="$(mktemp -d)"
  trap 'rm -rf "$testing"' EXIT
  (cd "$ROOT" && bash -c "$TEST_BUILD" _ "$testing") \
    || { echo "Bundle check: the build in test mode failed." >&2; exit 1; }
  if ! grep -rqsF --include='*.js' "$DETACHING" "$testing"; then
    echo "Bundle check FAILED: it does not recognise \`detaching\` in the library built in test mode (the check's own rule)." >&2
    exit 1
  fi
  mapfile -t built < <(find "$testing" -type f -name '*.js')
  if ! carries_trap "${built[@]}"; then
    echo "Bundle check FAILED: it does not recognise the trap in the library built in test mode (ADR-0021)." >&2
    exit 1
  fi
  if ! carries_trap "$package/wasm/test-mode/engine_bg.wasm"; then
    echo "Bundle check FAILED: it does not recognise the engine built in test mode (ADR-0021)." >&2
    exit 1
  fi
  for glue in "$package/wasm/engine.js" "$package/wasm/test-mode/engine.js"; do
    if [[ ! -f "$glue" ]]; then
      echo "Bundle check FAILED: ${glue#"$ROOT/"} is missing — run \`bun run build:engine\`." >&2
      exit 1
    fi
  done
  if ! cmp -s "$package/wasm/engine.js" "$package/wasm/test-mode/engine.js"; then
    echo "Bundle check FAILED: wasm/test-mode/engine.js differs from wasm/engine.js, the glue the example hands the engine built in test mode over with (ADR-0021)." >&2
    exit 1
  fi
fi
echo "Bundle check passed: $total bytes gzipped in $count files, budget $BUDGET (Q-3)."
