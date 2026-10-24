#!/usr/bin/env bash
#
# Structural test of the shape of the code (ADR-0009) and of how the scene draws (ADR-0012,
# ADR-0018).
# Verifies: ADR-0026, ADR-0027, ADR-0018
#
# ADR-0009 builds Comb as a functional core of pure Rust and a TypeScript shell whose only door to
# the engine is its bridge; ADR-0012 draws every text as BitmapText and the edges as one mesh. This
# check reads the tree and fails on what would break that shape:
#
#   1. Core: the core crate crates/engine depends on no crate that reaches the browser, the clock,
#      randomness, or I/O — wasm-bindgen, js-sys, web-sys, getrandom, serde-wasm-bindgen. Its
#      Cargo.toml names none of them, as a key, quoted or not, as a table header, or as the
#      `package` a key renames; and where Cargo.lock exists, it resolves the crate the core's
#      Cargo.toml names, and none is among the packages it resolves for it, however indirectly.
#   2. Bridge: no source file outside packages/comb/src/bridge/ imports from the WebAssembly
#      package, any module path under wasm/ whose name starts with `engine`, by import, re-export,
#      dynamic import, or require, in quotes or backticks.
#   3. Render: the render layer sees the state without its actions (GraphView), so the type
#      checker refuses a write. Its files name neither GraphState, GraphStore, nor the store's
#      getState, setState, or subscribe.
#   4. Examples: no file under examples/ imports a path inside the library: only the package's
#      entries `comb` and `comb/testing`, and the engine file it exports as `comb/engine.wasm`,
#      bare or as a URL with Vite's `?url` (ADR-0019), never another `comb/...`, a path through
#      node_modules/comb/, or into packages/comb.
#   5. Drawing: no file of the render layer names PixiJS's Text, HTMLText, or SplitText, which
#      redraw a canvas and upload a texture on every change; and the edges layer,
#      packages/comb/src/render/edges.ts, which exists wherever the render layer does, names no
#      Graphics, so no edge is drawn by one. Its Canvas 2D fallback (ADR-0018),
#      packages/comb/src/render/edges-canvas.ts, where it exists, names Graphics only in import
#      statements, on one line or several, never renamed with `as`, and on exactly one line that
#      declares a readonly class field `= new Graphics()`: one drawing, made with the layer, never
#      in a loop over edges or triangles. What text cannot decide is left to review: a class with
#      that one field created once per edge, or a Graphics made by a factory in another file.
#
# Source files are .ts, .tsx, .mts, .cts, .js, .jsx, .mjs, and .cjs; test files are read like any
# other. Dependencies (node_modules/) and the library's generated directories
# (packages/comb/wasm/ and packages/comb/dist/) are not read. Pure bash + coreutils/grep/awk/find.
# Usage:
#     scripts/check-structure.sh [repository root]
# The root defaults to this repository; scripts/test-check-structure.sh passes fixtures.
# Exit code 0 when the check passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd)"
cd "$ROOT" || exit 1

problems=()

# sources <dir> — the source files under a directory, without dependencies or generated output.
sources() {
  [[ -d "$1" ]] || return 0
  find "$1" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \
    -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) \
    -not -path '*/node_modules/*' -not -path 'packages/comb/wasm/*' \
    -not -path 'packages/comb/dist/*' | sort
}

# report <file> <pattern> <message> [allowed] — one problem per match of the pattern that is not,
# as a whole, a match of the allowed pattern; each match is judged on its own, so an allowed
# import does not hide a forbidden one on the same line.
report() {
  local hit
  while IFS= read -r hit; do
    problems+=("$1:${hit%%:*}: $3")
  done < <(grep -noE "$2" "$1" | { if [[ -n "${4:-}" ]]; then grep -vE "^[0-9]+:($4)$"; else cat; fi; })
}

# The quotes a module specifier stands in, and what may stand between them.
quote="[\"'\`]"
inside="[^\"'\`]"
# An import, re-export, dynamic import, or require of a module specifier, a comment allowed before
# the string.
specifier="(from|import|require)[[:space:]]*\(?[[:space:]]*(/\*([^*]|\*[^/])*\*/[[:space:]]*)?$quote"

# 1. Core
forbidden='wasm-bindgen|js-sys|web-sys|getrandom|serde-wasm-bindgen'
q="[\"']?"
core="crates/engine/Cargo.toml"
if [[ -f "$core" ]]; then
  report "$core" \
    "^[[:space:]]*$q($forbidden)${q}[[:space:]]*[=.]|^[[:space:]]*\[[^]]*dependencies\.$q($forbidden)${q}[[:space:]]*\]|package[[:space:]]*=[[:space:]]*$q($forbidden)$q" \
    "the core names a crate that reaches the browser, the clock, randomness, or I/O"
fi
engine="$(awk -F'"' '/^\[package\]/ { p = 1; next } /^\[/ { p = 0 } p && /^name[[:space:]]*=/ { print $2; exit }' "$core" 2> /dev/null)"
if [[ -f Cargo.lock ]] && ! grep -qx "name = \"$engine\"" Cargo.lock; then
  problems+=("Cargo.lock: no package named \"${engine:-?}\", the core crate of $core; regenerate the lock")
elif [[ -f Cargo.lock ]]; then
  while IFS= read -r crate; do
    problems+=("Cargo.lock: the core depends on $crate through its dependencies")
  done < <(awk -v forbidden="^($forbidden)$" -v root="$engine" '
    /^\[\[package\]\]/ { name = ""; in_deps = 0; next }
    /^name = / { gsub(/"/, "", $3); name = $3; next }
    /^dependencies = \[/ { in_deps = 1; next }
    in_deps && /^\]/ { in_deps = 0; next }
    in_deps { dep = $0; gsub(/[",]/, "", dep); split(dep, parts, " "); deps[name] = deps[name] " " parts[1] }
    END {
      queue[1] = root; head = 1; tail = 1; seen[root] = 1
      while (head <= tail) {
        current = queue[head++]
        n = split(deps[current], list, " ")
        for (i = 1; i <= n; i++) if (!(list[i] in seen)) { seen[list[i]] = 1; queue[++tail] = list[i] }
      }
      for (crate in seen) if (crate ~ forbidden) print crate
    }' Cargo.lock | sort)
fi

# 2. Bridge
for dir in packages examples; do
  while IFS= read -r file; do
    [[ "$file" == packages/comb/src/bridge/* ]] && continue
    report "$file" "${specifier}${inside}*wasm/engine${inside}*${quote}" \
      "only packages/comb/src/bridge/ imports the WebAssembly package"
  done < <(sources "$dir")
done

# 3. Render
while IFS= read -r file; do
  report "$file" '\b(GraphState|GraphStore|getState|setState|subscribe)\b' \
    "the render layer sees GraphView only and never reaches the store"
done < <(sources packages/comb/src/render)

# 4. Examples
while IFS= read -r file; do
  report "$file" "${specifier}((comb|${inside}*/comb)/${inside}*|${inside}*packages/comb${inside}*)${quote}" \
    "an example imports only the package entries \"comb\", \"comb/testing\", and \"comb/engine.wasm\"" \
    "${specifier}comb/(testing|engine\.wasm(\?url)?)${quote}"
done < <(sources examples)

# 5. Drawing
while IFS= read -r file; do
  report "$file" '\b(Text|HTMLText|SplitText)\b' \
    "the render layer draws text as BitmapText, never as Text, HTMLText, or SplitText"
done < <(sources packages/comb/src/render)
edges="packages/comb/src/render/edges.ts"
if [[ -d packages/comb/src/render && ! -f "$edges" ]]; then
  problems+=("$edges: missing; the edges layer of the render layer lives there")
elif [[ -f "$edges" ]]; then
  report "$edges" '\bGraphics\b' "the edges layer draws its edges as one mesh, never by Graphics"
fi
fill="packages/comb/src/render/edges-canvas.ts"
if [[ -f "$fill" ]]; then
  s='[[:space:]]*'
  field="${s}readonly[[:space:]]+[A-Za-z_][A-Za-z0-9_]*$s=${s}new Graphics[(][)];?$s"
  import="import[[:space:]][^;]*from$s$quote$inside*$quote;?$s"
  # Lines naming Graphics outside an import and the field, and imports that rename it; a
  # multi-line import runs from `import ... {` to the line with its closing brace.
  lines="$(awk -v field="^$field\$" -v import="^$import\$" -v closing="^[^;]*}${s}from$s$quote$inside*$quote;?$s\$" '
    { names = $0 ~ /(^|[^A-Za-z0-9_$])Graphics([^A-Za-z0-9_$]|$)/
      renamed = $0 ~ /(^|[^A-Za-z0-9_$])Graphics[[:space:]]+as([^A-Za-z0-9_$]|$)/ }
    block && /}/ { block = 0; if (renamed || (names && $0 !~ closing)) print FNR; next }
    block { if (renamed) print FNR; next }
    $0 ~ import { if (renamed) print FNR; next }
    /^import[[:space:]][^}]*\{[^}]*$/ { block = 1; if (renamed) print FNR; next }
    names && $0 !~ field { print FNR }' "$fill")" \
    || problems+=("$fill: the check could not read it")
  while IFS= read -r line; do
    [[ -n "$line" ]] \
      && problems+=("$fill:$line: the Canvas 2D fallback names Graphics only in imports and one field")
  done <<< "$lines"
  fields="$(grep -cE "^$field$" "$fill")"
  if [[ "$fields" != 1 ]]; then
    problems+=("$fill: the Canvas 2D fallback fills all edges into one Graphics field, found $fields")
  fi
fi

if ((${#problems[@]})); then
  echo "Structure check FAILED (ADR-0009, ADR-0012, ADR-0018):" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "Structure check passed (core, bridge, render, examples, drawing)."
