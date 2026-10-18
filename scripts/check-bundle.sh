#!/usr/bin/env bash
#
# Bundle budget of the library (ADR-0008). Verifies: Q-3
#
# Q-3 keeps the library bundle — Comb's JavaScript and WebAssembly, gzipped, without PixiJS —
# under 300 kB. Without arguments this builds the bundle with `bun run build:lib` into
# packages/comb/dist and measures it; with a directory it measures the .js and .wasm files there,
# which is how scripts/test-check-bundle.sh passes fixtures. Each file is gzipped at level 9 and
# the sizes are summed; 1 kB is 1,000 bytes.
#
# The bundle must carry the WebAssembly, as a .wasm file or inlined as a data URL, or the check
# fails: a bundle of JavaScript alone would pass while measuring less than Q-3 means. Vite inlines
# it as base64, which gzips about 10 kB larger than the raw module: the check errs on the safe
# side, and that is not to be "fixed" by measuring the module apart.
#
# Nor may the bundle carry the bridge's test mode (ADR-0010), which only tests run in: a production
# build leaves it out, and its error message in a .js file shows that it did not. Without
# arguments the check also builds the library in Vite's test mode and fails unless it tells that
# bundle by the message, so a change to the message turns it red rather than blind.
#
# Usage:
#     scripts/check-bundle.sh [directory [budget in bytes]]
# Exit code 0 when the bundle is under the budget, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUDGET="${2:-300000}"

if (($# == 0)); then
  (cd "$ROOT" && bun run build:lib > /dev/null) || { echo "Bundle check: the build failed." >&2; exit 1; }
  dir="$ROOT/packages/comb/dist"
else
  dir="$1"
fi

total=0
count=0
while IFS= read -r -d '' file; do
  size="$(gzip -9 -c "$file" | wc -c)"
  total=$((total + size))
  count=$((count + 1))
done < <(find "$dir" -type f \( -name '*.js' -o -name '*.wasm' \) -print0)

if ((count == 0)); then
  echo "Bundle check FAILED: no .js or .wasm file in $dir." >&2
  exit 1
fi
if [[ -z "$(find "$dir" -type f -name '*.wasm' -print -quit)" ]] \
  && ! grep -rqs --include='*.js' 'data:application/wasm' "$dir"; then
  echo "Bundle check FAILED: no WebAssembly in $dir, neither a .wasm file nor inlined (Q-3)." >&2
  exit 1
fi
if grep -rqs --include='*.js' 'Comb test mode' "$dir"; then
  echo "Bundle check FAILED: the bundle carries the bridge's test mode (ADR-0010)." >&2
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
fi
echo "Bundle check passed: $total bytes gzipped in $count files, budget $BUDGET (Q-3)."
