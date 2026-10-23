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
# Nor may the bundle carry the bridge's test mode (ADR-0010), which only tests run in: a production
# build leaves it out, and its error message in a .js file shows that it did not. Without
# arguments the check also builds the library in Vite's test mode and fails unless it tells that
# bundle by the message, so a change to the message turns it red rather than blind.
#
# Nor may it carry the trap the bridge crate exports in test mode (ADR-0021): an engine file that
# names the export `comb_test_mode_trap` fails. Without arguments the check also fails unless it
# finds that name in the engine built in test mode, packages/comb/wasm/test-mode/engine_bg.wasm,
# so a renamed export turns it red rather than blind.
# Verifies: ADR-0021
#
# Usage:
#     scripts/check-bundle.sh [directory [budget in bytes]]
# Exit code 0 when the bundle is under the budget, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUDGET="${2:-300000}"

files=()
if (($# == 0)); then
  (cd "$ROOT" && bun run build:lib > /dev/null) || { echo "Bundle check: the build failed." >&2; exit 1; }
  dir="$ROOT/packages/comb/dist"
  package="$ROOT/packages/comb"
  engine="$(cd "$package" && bun -e 'console.log(require("./package.json").exports["./engine.wasm"] ?? "")')"
  [[ -n "$engine" && -f "$package/$engine" ]] && files+=("$package/$engine")
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
if grep -rqs --include='*.js' 'Comb test mode' "$dir"; then
  echo "Bundle check FAILED: the bundle carries the bridge's test mode (ADR-0010)." >&2
  exit 1
fi
# carries_trap <file>... — whether any of the files names the export of the engine's trap.
carries_trap() {
  local file
  for file in "$@"; do
    grep -qsaF 'comb_test_mode_trap' "$file" && return 0
  done
  return 1
}
if carries_trap "${files[@]}"; then
  echo "Bundle check FAILED: the bundle carries the engine's trap of test mode (ADR-0021)." >&2
  exit 1
fi
if ((total >= BUDGET)); then
  echo "Bundle check FAILED: $total bytes gzipped in $count files, budget $BUDGET (Q-3)." >&2
  exit 1
fi
if (($# == 0)); then
  testing="$(mktemp -d)"
  trap 'rm -rf "$testing"' EXIT
  (cd "$ROOT/packages/comb" && bunx --bun vite build --mode test --outDir "$testing" > /dev/null) \
    || { echo "Bundle check: the build in test mode failed." >&2; exit 1; }
  if ! grep -rqs --include='*.js' 'Comb test mode' "$testing"; then
    echo "Bundle check FAILED: it does not recognise the library built in test mode (ADR-0010)." >&2
    exit 1
  fi
  if ! carries_trap "$package/wasm/test-mode/engine_bg.wasm"; then
    echo "Bundle check FAILED: it does not recognise the engine built in test mode (ADR-0021)." >&2
    exit 1
  fi
fi
echo "Bundle check passed: $total bytes gzipped in $count files, budget $BUDGET (Q-3)."
