#!/usr/bin/env bash
#
# Check of the dependencies the toolchain, the bridge, and the store decided.
# Verifies: ADR-0008, ADR-0033, ADR-0029
#
# Fails on what would undo those decisions without a word:
#
#   1. Lockfiles (ADR-0008): Bun is the package manager, so no package-lock.json,
#      npm-shrinkwrap.json, yarn.lock, or pnpm-lock.yaml lies in the tree beside bun.lock. In a git
#      repository the tree is what git tracks or would track (.gitignore honoured); elsewhere every
#      file outside node_modules/, .git/, and target/.
#   2. Bridge (ADR-0033): the tsify entry of crates/engine-wasm/Cargo.toml, in whatever form —
#      a version string, an inline table over one or more lines, a [dependencies.tsify] table,
#      under [target.'…'.dependencies] or not, or inherited with `workspace = true` from the root
#      Cargo.toml's [workspace.dependencies] — says `default-features = false` and enables no
#      `json` feature; and no serde_json is named, under any key or as a renamed `package`.
#   3. Store (ADR-0029): the dependency lists of packages/comb/package.json (dependencies,
#      devDependencies, peerDependencies, optionalDependencies) name none of the state libraries
#      listed below; zustand is the store.
#
# Pure bash + coreutils/grep/awk/find (git where the root is a repository). Usage:
#     scripts/check-dependencies.sh [repository root]
# The root defaults to this repository; scripts/test-check-dependencies.sh passes fixtures.
# Exit code 0 when the check passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd)"
cd "$ROOT" || exit 1

problems=()

# 1. Lockfiles
files() {
  if git rev-parse --show-toplevel > /dev/null 2>&1 \
    && [[ "$(git rev-parse --show-toplevel)" == "$ROOT" ]]; then
    git ls-files --cached --others --exclude-standard
  else
    find . \( -name node_modules -o -name .git -o -name target \) -prune -o -type f -print \
      | sed 's|^\./||'
  fi
}
while IFS= read -r lock; do
  problems+=("$lock: a lockfile of another package manager; Bun's bun.lock is the one")
done < <(files | grep -E '(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$' \
  | sort)

# entry <Cargo.toml> <crate> <table> — the text of the crate's entry under the tables whose names
# end in <table> ('dependencies' or 'workspace.dependencies'), comments removed, joined on one line:
# a `crate = …` key with its inline table up to the closing brace, a dotted `crate.key = …`, or the
# body of a `[<table>.crate]` table.
entry() {
  awk -v crate="$2" -v table="$3" '
    { sub(/[[:space:]]*#.*/, "") }
    /^[[:space:]]*\[/ {
      header = $0; gsub(/[[:space:]]/, "", header)
      in_list = header ~ ("(^\\[|\\.)" table "\\]$") && !(table == "dependencies" && header ~ /workspace\.dependencies\]$/)
      in_table = header ~ ("(^\\[|\\.)" table "\\." crate "\\]$")
      depth = 0; next
    }
    in_table { printf "%s ", $0; next }
    in_list && depth == 0 && $0 ~ ("^[[:space:]]*" crate "[[:space:]]*[=.]") { depth = 1; open = 0 }
    depth > 0 {
      printf "%s ", $0
      open += gsub(/\{/, "{") - gsub(/\}/, "}")
      if (open <= 0) depth = 0
    }
  ' "$1"
}

bridge="crates/engine-wasm/Cargo.toml"
if [[ -f "$bridge" ]]; then
  tsify="$(entry "$bridge" tsify dependencies)"
  if [[ "$tsify" =~ workspace[[:space:]]*=[[:space:]]*true && -f Cargo.toml ]]; then
    tsify="$tsify $(entry Cargo.toml tsify workspace.dependencies)"
  fi
  if [[ -n "${tsify// /}" ]]; then
    if ! [[ "$tsify" =~ default-features[[:space:]]*=[[:space:]]*false ]]; then
      problems+=("$bridge: tsify keeps its default features, which serialize through JSON")
    fi
    if [[ "$tsify" =~ features[[:space:]]*=[[:space:]]*\[[^]]*\"json\" ]]; then
      problems+=("$bridge: tsify's json feature passes JSON strings")
    fi
  fi
  while IFS= read -r hit; do
    problems+=("$bridge:${hit%%:*}: serde_json passes structured data as JSON strings")
  done < <(grep -nE '^[^#]*\bserde[_-]json\b' "$bridge")
fi

# 3. Store
library="packages/comb/package.json"
stores='redux|react-redux|@reduxjs/toolkit|mobx|mobx-state-tree|jotai|valtio|recoil|xstate|@xstate/store|effector|nanostores|@nanostores/[a-z-]+|@preact/signals|@preact/signals-core|@tanstack/store|legend-state|@legendapp/state|pinia|vuex'
if [[ -f "$library" ]]; then
  while IFS= read -r name; do
    problems+=("$library: the store is zustand; $name is a state library")
  done < <(awk -v stores="^\"($stores)\"$" '
    { text = text $0 "\n" }
    END {
      gsub(/[{}]/, "\n&\n", text); gsub(/,/, "\n", text)
      n = split(text, lines, "\n")
      for (i = 1; i <= n; i++) {
        line = lines[i]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        if (line == "{") { depth++; if (depth == 2 && pending) list = 1; pending = 0; continue }
        if (line == "}") { if (depth == 2) list = 0; depth--; continue }
        if (depth == 1 && line ~ /^"(dependencies|devDependencies|peerDependencies|optionalDependencies)"[[:space:]]*:$/) { pending = 1; continue }
        pending = 0
        if (list && depth == 2) {
          key = line; sub(/[[:space:]]*:.*/, "", key)
          if (key ~ stores) { gsub(/"/, "", key); print key }
        }
      }
    }
  ' "$library")
fi

if ((${#problems[@]})); then
  echo "Dependency check FAILED (ADR-0008, ADR-0033, ADR-0029):" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "Dependency check passed (lockfiles, bridge, store)."
