#!/usr/bin/env bash
#
# Builds, tests, and lints Comb: the commands of the README's "Build, Test & Run" (ADR-0008),
# the tests running the check of the engine's freshness (scripts/check-engine.sh) first, and the
# bundle budget (scripts/check-bundle.sh, Q-3) last, which runs that check too. Both read what
# the build writes, so they run here, after it, rather than beside it in
# scripts/check-all.sh, whose checks run side by side; check 9 of scripts/check-docs.sh counts a
# script this one runs. The checks that need no toolchain, and the self-tests of these two, run
# on lines of their own in scripts/check-all.sh and in the code job of checks.yml.
#
# Needs Bun, Rust with the wasm32-unknown-unknown target, and Chromium for Playwright, as the Dev
# Container provides them (ADR-0014). Where Bun or Cargo is missing it fails and says so: a gate
# that skips itself is one somebody believes in and does not have.
#
# Usage:
#     scripts/check-code.sh
# Exit code 0 when the build, the lint, the tests, and the bundle budget pass, non-zero at the
# first that fails.

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
bash scripts/check-bundle.sh
echo "Build, lint, tests, and bundle budget passed."
