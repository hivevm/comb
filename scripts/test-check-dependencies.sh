#!/usr/bin/env bash
#
# Self-test of scripts/check-dependencies.sh. Verifies: ADR-0008, ADR-0034, ADR-0029
#
# Each case builds a fixture tree under a temporary directory — bun.lock, the bridge crate's
# Cargo.toml, and the library's package.json — runs the check against it, and asserts the exit
# code and, for a failing case, the message that names the offence. The baseline passes; every
# failing case breaks one rule in one form, and the passing cases are near misses the check must
# not mistake for offences.
#
# Usage:
#     scripts/test-check-dependencies.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-dependencies.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# fixture <name> — a tree that keeps every rule; prints its path.
fixture() {
  local d="$work/$1"
  mkdir -p "$d/crates/engine-wasm" "$d/packages/comb"
  echo '{}' > "$d/bun.lock"
  cat > "$d/crates/engine-wasm/Cargo.toml" <<'TOML'
[dependencies]
serde = { version = "1.0.229", features = ["derive"] }
serde-wasm-bindgen = "0.6.5"
tsify = { version = "0.5.8", default-features = false, features = ["js"] }
TOML
  cat > "$d/packages/comb/package.json" <<'JSON'
{
  "name": "comb",
  "dependencies": {
    "pixi.js": "8.22.0",
    "zustand": "5.0.15"
  }
}
JSON
  echo "$d"
}

# edit <file> <sed script> — rewrite a fixture file through a temporary file, portably.
edit() {
  sed "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

# depend <dir> <name> — the library's package.json with one more dependency beside zustand.
depend() {
  printf '{\n  "name": "comb",\n  "dependencies": {\n    "zustand": "5.0.15",\n    "%s": "1.0.0"\n  }\n}\n' \
    "$2" > "$1/packages/comb/package.json"
}

# expect <pass|fail> <description> <dir> [pattern] — run the check, assert the outcome and, for a
# failure, that the output contains the pattern.
expect() {
  local want="$1" desc="$2" dir="$3" pattern="${4:-}" out rc
  out="$(bash "$CHECK" "$dir" 2>&1)"; rc=$?
  if [[ "$want" == pass && $rc -eq 0 ]] \
    || [[ "$want" == fail && $rc -eq 1 && ( -z "$pattern" || "$out" == *"$pattern"* ) ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "FAIL: $desc (expected $want, exit $rc)" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
  fi
}

d="$(fixture baseline)"
expect pass "a tree that keeps every rule passes" "$d"

d="$(fixture npm-lock)"
echo '{}' > "$d/package-lock.json"
expect fail "a package-lock.json beside bun.lock fails" "$d" "package-lock.json: a lockfile"

d="$(fixture nested-yarn)"
echo '' > "$d/packages/comb/yarn.lock"
expect fail "a yarn.lock in a workspace fails" "$d" "packages/comb/yarn.lock"

d="$(fixture pnpm-lock)"
echo '' > "$d/pnpm-lock.yaml"
expect fail "a pnpm-lock.yaml fails" "$d" "pnpm-lock.yaml"

d="$(fixture dependency-lock)"
mkdir -p "$d/node_modules/x"
echo '{}' > "$d/node_modules/x/package-lock.json"
expect pass "a lockfile inside node_modules is not read" "$d"

d="$(fixture tsify-defaults)"
edit "$d/crates/engine-wasm/Cargo.toml" 's/default-features = false, //'
expect fail "tsify with its default features fails" "$d" "tsify keeps its default features"

d="$(fixture tsify-json)"
edit "$d/crates/engine-wasm/Cargo.toml" 's/features = \["js"\]/features = ["js", "json"]/'
expect fail "tsify's json feature fails" "$d" "tsify's json feature"

d="$(fixture serde-json)"
echo 'serde_json = "1.0"' >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "serde_json in the bridge fails" "$d" "serde_json passes structured data"

d="$(fixture serde-json-table)"
printf '\n[dependencies.serde_json]\nversion = "1.0"\n' >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "serde_json as a table fails" "$d" "serde_json passes structured data"

d="$(fixture serde-json-comment)"
echo '# serde_json is not used: ADR-0034' >> "$d/crates/engine-wasm/Cargo.toml"
expect pass "serde_json named in a comment passes" "$d"

d="$(fixture redux)"
depend "$d" "@reduxjs/toolkit"
expect fail "a second store library fails" "$d" "@reduxjs/toolkit is a state library"

d="$(fixture jotai-dev)"
cat > "$d/packages/comb/package.json" <<'JSON'
{
  "name": "comb",
  "dependencies": { "zustand": "5.0.15" },
  "devDependencies": {
    "jotai": "2.0.0"
  }
}
JSON
expect fail "a store library among the dev dependencies fails" "$d" "jotai is a state library"

d="$(fixture zustand-middleware)"
depend "$d" "zustand-x"
expect pass "a package whose name starts like a store library passes" "$d"

d="$(fixture tsify-short)"
edit "$d/crates/engine-wasm/Cargo.toml" 's/^tsify = .*/tsify = "0.5.8"/'
expect fail "tsify as a bare version keeps its defaults and fails" "$d" "tsify keeps its default"

d="$(fixture tsify-table)"
edit "$d/crates/engine-wasm/Cargo.toml" '/^tsify = /d'
printf '\n[dependencies.tsify]\nversion = "0.5.8"\nfeatures = ["js"]\n' >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "tsify as a table with its defaults fails" "$d" "tsify keeps its default"

d="$(fixture tsify-table-clean)"
edit "$d/crates/engine-wasm/Cargo.toml" '/^tsify = /d'
printf '\n[dependencies.tsify]\nversion = "0.5.8"\ndefault-features = false\nfeatures = ["js"]\n' \
  >> "$d/crates/engine-wasm/Cargo.toml"
expect pass "tsify as a table without its defaults passes" "$d"

d="$(fixture tsify-multiline-json)"
edit "$d/crates/engine-wasm/Cargo.toml" '/^tsify = /d'
printf 'tsify = {\n  version = "0.5.8",\n  default-features = false,\n  features = ["js", "json"],\n}\n' \
  >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "tsify's json feature on a later line of an inline table fails" "$d" "json feature"

d="$(fixture tsify-multiline-clean)"
edit "$d/crates/engine-wasm/Cargo.toml" '/^tsify = /d'
printf 'tsify = {\n  version = "0.5.8",\n  default-features = false,\n  features = ["js"],\n}\n' \
  >> "$d/crates/engine-wasm/Cargo.toml"
expect pass "a multi-line inline table without defaults passes" "$d"

d="$(fixture tsify-workspace)"
edit "$d/crates/engine-wasm/Cargo.toml" 's/^tsify = .*/tsify.workspace = true/'
printf '[workspace.dependencies]\ntsify = "0.5.8"\n' > "$d/Cargo.toml"
expect fail "tsify inherited from a workspace entry with its defaults fails" "$d" "tsify keeps"

d="$(fixture tsify-workspace-clean)"
edit "$d/crates/engine-wasm/Cargo.toml" 's/^tsify = .*/tsify = { workspace = true, features = ["js"] }/'
printf '[workspace.dependencies]\ntsify = { version = "0.5.8", default-features = false }\n' \
  > "$d/Cargo.toml"
expect pass "tsify inherited without its defaults passes" "$d"

d="$(fixture tsify-target)"
edit "$d/crates/engine-wasm/Cargo.toml" '/^tsify = /d'
printf "\n[target.'cfg(target_arch = \"wasm32\")'.dependencies]\ntsify = \"0.5.8\"\n" \
  >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "tsify with its defaults under a target table fails" "$d" "tsify keeps"

d="$(fixture serde-json-renamed)"
echo 'json = { package = "serde_json", version = "1.0" }' >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "serde_json under another key fails" "$d" "serde_json passes structured data"

d="$(fixture serde-json-workspace)"
echo 'serde_json.workspace = true' >> "$d/crates/engine-wasm/Cargo.toml"
expect fail "serde_json inherited from the workspace fails" "$d" "serde_json passes"

d="$(fixture lock-in-example)"
mkdir -p "$d/examples/demo"
echo '' > "$d/examples/demo/yarn.lock"
expect fail "a lockfile in an example fails" "$d" "examples/demo/yarn.lock"

d="$(fixture shrinkwrap)"
echo '{}' > "$d/npm-shrinkwrap.json"
expect fail "an npm-shrinkwrap.json fails" "$d" "npm-shrinkwrap.json"

d="$(fixture ignored-lock)"
mkdir -p "$d/dist"
echo '{}' > "$d/dist/package-lock.json"
printf 'dist/\n' > "$d/.gitignore"
git -C "$d" init -q
expect pass "a lockfile git ignores is not read" "$d"

d="$(fixture peer-store)"
cat > "$d/packages/comb/package.json" <<'JSON'
{ "name": "comb", "dependencies": { "zustand": "5.0.15" }, "peerDependencies": { "mobx": "6" } }
JSON
expect fail "a store library among the peer dependencies of one-line JSON fails" "$d" "mobx is"

d="$(fixture optional-store)"
cat > "$d/packages/comb/package.json" <<'JSON'
{
  "name": "comb",
  "optionalDependencies": { "@tanstack/store": "0.7.0" }
}
JSON
expect fail "a store library among the optional dependencies fails" "$d" "@tanstack/store is"

d="$(fixture script-named-like-a-store)"
cat > "$d/packages/comb/package.json" <<'JSON'
{
  "name": "comb",
  "scripts": { "xstate": "echo not a dependency" },
  "dependencies": { "zustand": "5.0.15" }
}
JSON
expect pass "a script named like a store library passes" "$d"

if ((failed)); then
  echo "Dependency check self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Dependency check self-test passed ($passed cases)."
