#!/usr/bin/env bash
#
# Builds, tests, and lints Comb: the commands of the README's "Build, Test & Run" (ADR-0008),
# with the shape of the code (scripts/check-structure.sh, ADR-0026) and the decided dependencies
# (scripts/check-dependencies.sh, ADR-0008, ADR-0010, ADR-0011) first, since they need no
# toolchain and a red test must not hide them, and the bundle budget (scripts/check-bundle.sh,
# Q-3) last, each after its self-test.
#
# Needs Bun, Rust with the wasm32-unknown-unknown target, and Chromium for Playwright, as the Dev
# Container provides them (ADR-0014). Where Bun or Cargo is missing it fails and says so: a gate
# that skips itself is one somebody believes in and does not have.
#
# Usage:
#     scripts/check-code.sh
# Exit code 0 when the structure, the build, the lint, the tests, and the bundle budget pass,
# non-zero at the first that fails.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash scripts/test-check-structure.sh
bash scripts/check-structure.sh
bash scripts/test-check-dependencies.sh
bash scripts/check-dependencies.sh

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
bash scripts/test-check-bundle.sh
bash scripts/check-bundle.sh
echo "Structure, build, lint, tests, and bundle budget passed."
