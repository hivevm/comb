#!/usr/bin/env bash
#
# Freshness of the engine the tests run (ADR-0008).
#
# `bun run build:engine` writes the engine into packages/comb/wasm/ and the engine built in test
# mode into packages/comb/wasm/test-mode/, generated and untracked. The TypeScript tests and the
# bundle check read whatever those directories hold, so a change to crates/ that is not built yet
# would be tested in the engine of an earlier change. This check fails, naming the file and the
# command to run, when either engine file is missing or older than the newest of the sources it is
# built from: every file under crates/, Cargo.toml, and Cargo.lock. It passes silently.
# `bun run test` and scripts/check-bundle.sh run it before anything else.
#
# Usage:
#     scripts/check-engine.sh [repository root]
# The root defaults to this repository; scripts/test-check-engine.sh passes fixture trees.
# Exit code 0 when both engine files are newer than every source, 1 otherwise.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 1

failed=0
for engine in packages/comb/wasm/engine_bg.wasm packages/comb/wasm/test-mode/engine_bg.wasm; do
  if [[ ! -f "$engine" ]]; then
    echo "Engine check FAILED: $engine is missing — run \`bun run build:engine\`." >&2
    failed=1
    continue
  fi
  newer="$(find crates Cargo.toml Cargo.lock -type f -newer "$engine" -print -quit 2> /dev/null)"
  if [[ -n "$newer" ]]; then
    echo "Engine check FAILED: $engine is older than $newer — run \`bun run build:engine\`." >&2
    failed=1
  fi
done
exit "$failed"
