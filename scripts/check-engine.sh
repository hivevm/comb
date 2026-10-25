#!/usr/bin/env bash
#
# Freshness of the engine the tests run. Dev-only tooling, it decides no ADR or criterion and
# cites none.
#
# `bun run build:engine` writes the engine into packages/comb/wasm/ and the engine built in test
# mode into packages/comb/wasm/test-mode/, generated and untracked. The TypeScript tests and the
# bundle check read whatever those directories hold, so a change to crates/ that is not built yet
# would be tested in the engine of an earlier change. This check fails, naming the file and the
# command to run, when either engine file is missing or older than the newest of the sources it is
# built from: every file under crates/ but those no build reads, Cargo.toml, and Cargo.lock. It
# passes silently. A root without those sources fails, since there would be nothing to compare
# with.
# `bun run test`, `bun run dev`, which Playwright serves the example with, and
# scripts/check-bundle.sh run it before anything else.
#
# Usage:
#     scripts/check-engine.sh [repository root]
# The root defaults to this repository; scripts/test-check-engine.sh passes fixture trees.
# Exit code 0 when both engine files are newer than every source, 1 otherwise.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 1
if [[ ! -d crates || ! -f Cargo.toml || ! -f Cargo.lock ]]; then
  echo "Engine check FAILED: $ROOT holds no crates/, Cargo.toml, and Cargo.lock to compare with." >&2
  exit 1
fi

# What lies under crates/ but no build reads: the survivors of mutation testing, the cases proptest
# records when a property fails, a run of cargo-mutants started inside a crate, and the swap and
# backup files of editors. Any other file counts, so that an input nobody listed here makes the
# engine stale rather than leave it unchecked.
NOT_SOURCES=(-name mutants-missed.txt -o -name proptest-regressions -o -name 'mutants.out*'
  -o -name '*.swp' -o -name '*.swo' -o -name '*~' -o -name '.#*')

failed=0
for engine in packages/comb/wasm/engine_bg.wasm packages/comb/wasm/test-mode/engine_bg.wasm; do
  if [[ ! -f "$engine" ]]; then
    echo "Engine check FAILED: $engine is missing — run \`bun run build:engine\`." >&2
    failed=1
    continue
  fi
  newer="$(find crates Cargo.toml Cargo.lock \( "${NOT_SOURCES[@]}" \) -prune -o \
    -type f -newer "$engine" -print -quit)"
  if [[ -n "$newer" ]]; then
    echo "Engine check FAILED: $engine is older than $newer — run \`bun run build:engine\`." >&2
    failed=1
  fi
done
exit "$failed"
