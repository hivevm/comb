#!/usr/bin/env bash
#
# Builds, tests, and lints Comb: the commands of the README's "Build, Test & Run" (ADR-0008).
#
# Needs Bun, Rust with the wasm32-unknown-unknown target, and Chromium for Playwright, as the Dev
# Container provides them (ADR-0014). Where Bun or Cargo is missing it fails and says so: a gate
# that skips itself is one somebody believes in and does not have.
#
# Usage:
#     scripts/check-code.sh
# Exit code 0 when the build, the tests, and the lint pass, non-zero otherwise.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

missing=()
for tool in bun cargo; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done
if ((${#missing[@]})); then
  echo "check-code: ${missing[*]} not found — run it in the Dev Container (ADR-0014)." >&2
  exit 1
fi

bun install --frozen-lockfile
bun run build
bun run lint
bun run test
echo "Build, test, and lint passed."
