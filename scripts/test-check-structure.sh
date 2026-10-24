#!/usr/bin/env bash
#
# Self-test of scripts/check-structure.sh. Verifies: ADR-0028, ADR-0027, ADR-0018
#
# Each case builds a fixture tree under a temporary directory — a core crate with its lock, a
# library with a bridge, a store, and a render layer, and an example — runs the check against it,
# and asserts the exit code and, for a failing case, the message that names the offence. The
# baseline passes; every failing case breaks one rule of ADR-0028 or ADR-0027 in one form, and
# the passing cases are near misses the check must not mistake for offences.
#
# Usage:
#     scripts/test-check-structure.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-structure.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# fixture <name> — a tree that keeps every rule; prints its path.
fixture() {
  local d="$work/$1"
  mkdir -p "$d/crates/engine" "$d/packages/comb/src/bridge" "$d/packages/comb/src/render" \
    "$d/packages/comb/src/store" "$d/examples/demo/src"
  printf '[package]\nname = "comb-engine"\n\n[dependencies]\n' > "$d/crates/engine/Cargo.toml"
  cat > "$d/Cargo.lock" <<'LOCK'
version = 4

[[package]]
name = "comb-engine"
version = "0.0.0"

[[package]]
name = "comb-engine-wasm"
version = "0.0.0"
dependencies = [
 "comb-engine",
 "wasm-bindgen",
]

[[package]]
name = "wasm-bindgen"
version = "0.2.129"
LOCK
  echo 'import init from "../../wasm/engine.js";' > "$d/packages/comb/src/bridge/index.ts"
  echo 'import type { GraphView } from "../store";' > "$d/packages/comb/src/render/scene.ts"
  echo 'import { Mesh } from "pixi.js";' > "$d/packages/comb/src/render/edges.ts"
  echo 'export const store = { select() {} };' > "$d/packages/comb/src/store/index.ts"
  echo 'import { createComb } from "comb";' > "$d/examples/demo/src/main.ts"
  echo "$d"
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

# 1. Core
d="$(fixture core-dep)"
printf 'wasm-bindgen = "0.2"\n' >> "$d/crates/engine/Cargo.toml"
expect fail "the core depending on wasm-bindgen fails" "$d" "crates/engine/Cargo.toml:5"

d="$(fixture core-quoted-key)"
printf '"wasm-bindgen" = "0.2"\n' >> "$d/crates/engine/Cargo.toml"
expect fail "a quoted key fails" "$d" "the core names a crate"

d="$(fixture core-dotted)"
printf 'getrandom.version = "0.3"\n' >> "$d/crates/engine/Cargo.toml"
expect fail "a dotted key fails" "$d" "the core names a crate"

d="$(fixture core-table)"
printf '\n[dev-dependencies.web-sys]\nversion = "0.3"\n' >> "$d/crates/engine/Cargo.toml"
expect fail "a table header fails" "$d" "the core names a crate"

d="$(fixture core-quoted-table)"
printf '\n[dependencies."web-sys"]\nversion = "0.3"\n' >> "$d/crates/engine/Cargo.toml"
expect fail "a quoted table header fails" "$d" "the core names a crate"

d="$(fixture core-rename)"
printf "js = { package = 'js-sys', version = \"0.3\" }\n" >> "$d/crates/engine/Cargo.toml"
expect fail "a rename with single quotes fails" "$d" "the core names a crate"

d="$(fixture core-transitive)"
printf 'rand = "0.9"\n' >> "$d/crates/engine/Cargo.toml"
cat >> "$d/Cargo.lock" <<'LOCK'

[[package]]
name = "rand"
version = "0.9.0"
dependencies = [
 "rand_core",
]

[[package]]
name = "rand_core"
version = "0.9.0"
dependencies = [
 "getrandom 0.3.1",
]

[[package]]
name = "getrandom"
version = "0.3.1"
LOCK
awk '{ print } /^name = "comb-engine"$/ { print "dependencies = [\n \"rand\",\n]" }' \
  "$d/Cargo.lock" > "$d/Cargo.lock.tmp" && mv "$d/Cargo.lock.tmp" "$d/Cargo.lock"
expect fail "a forbidden crate reached through dependencies fails" "$d" \
  "the core depends on getrandom through its dependencies"

# 2. Bridge
d="$(fixture store-imports-wasm)"
echo 'import { Engine } from "../../wasm/engine.js";' >> "$d/packages/comb/src/store/index.ts"
expect fail "a module outside the bridge importing the package fails" "$d" \
  "packages/comb/src/store/index.ts:2"

d="$(fixture dynamic-import)"
echo 'const m = await import("../../wasm/engine");' >> "$d/packages/comb/src/store/index.ts"
expect fail "a dynamic import outside the bridge fails" "$d" "only packages/comb"

d="$(fixture wasm-url)"
echo 'import url from "../../wasm/engine_bg.wasm?url";' >> "$d/packages/comb/src/store/index.ts"
expect fail "importing the module's file by URL outside the bridge fails" "$d" "only packages/comb"

d="$(fixture js-file)"
echo 'export * from "../../wasm/engine_bg.js";' > "$d/packages/comb/src/store/raw.js"
expect fail "a JavaScript file outside the bridge fails" "$d" "packages/comb/src/store/raw.js:1"

d="$(fixture nested-wasm-dir)"
mkdir -p "$d/packages/comb/src/store/wasm"
echo 'import { Engine } from "../../../wasm/engine.js";' > "$d/packages/comb/src/store/wasm/x.ts"
expect fail "a source directory named wasm is still read" "$d" "packages/comb/src/store/wasm/x.ts:1"

# 3. Render
d="$(fixture render-state)"
echo 'export function f(state: GraphState) { return state; }' >> "$d/packages/comb/src/render/scene.ts"
expect fail "the render layer naming GraphState fails" "$d" "never reaches the store"

d="$(fixture render-destructures)"
echo 'const { select } = store.getState(); select(null);' >> "$d/packages/comb/src/render/scene.ts"
expect fail "the render layer reaching getState fails" "$d" "never reaches the store"

d="$(fixture render-set-state)"
echo 'store.setState({ selection: null });' >> "$d/packages/comb/src/render/scene.ts"
expect fail "the render layer calling setState fails" "$d" "never reaches the store"

d="$(fixture render-assets)"
echo 'await Assets.load("font.fnt"); const selectable = state.selection !== null;' \
  >> "$d/packages/comb/src/render/scene.ts"
expect pass "PixiJS's Assets.load and reading the selection pass" "$d"

# 4. Examples
d="$(fixture example-deep)"
echo 'import { Scene } from "comb/src/render/scene";' >> "$d/examples/demo/src/main.ts"
expect fail "an example importing inside the library fails" "$d" "examples/demo/src/main.ts:2"

d="$(fixture example-relative)"
echo 'import { createGraphStore } from "../../../packages/comb/src/store";' >> "$d/examples/demo/src/main.ts"
expect fail "an example importing by a relative path fails" "$d" "package entries"

d="$(fixture example-comment)"
echo 'const m = await import(/* @vite-ignore */ "comb/src/store");' >> "$d/examples/demo/src/main.ts"
expect fail "an import with a comment before the path fails" "$d" "package entries"

d="$(fixture example-node-modules)"
echo 'import { Scene } from "../node_modules/comb/src/render/scene";' >> "$d/examples/demo/src/main.ts"
expect fail "an import through node_modules/comb fails" "$d" "package entries"

d="$(fixture example-testing)"
echo 'import { inspect } from "comb/testing";' >> "$d/examples/demo/src/main.ts"
expect pass "an example importing the testing entry passes" "$d"

d="$(fixture example-testing-deep)"
echo 'import { scenes } from "comb/testing/scenes";' >> "$d/examples/demo/src/main.ts"
expect fail "an example importing below the testing entry fails" "$d" "package entries"

d="$(fixture example-engine)"
echo 'import engineUrl from "comb/engine.wasm?url";' >> "$d/examples/demo/src/main.ts"
echo 'import engine from "comb/engine.wasm";' >> "$d/examples/demo/src/main.ts"
expect pass "an example importing the engine file, bare or as a URL, passes" "$d"

d="$(fixture example-engine-other)"
echo 'import engine from "comb/engine.wasm?init";' >> "$d/examples/demo/src/main.ts"
echo 'import glue from "comb/wasm/engine_bg.wasm";' >> "$d/examples/demo/src/main.ts"
expect fail "an example importing the engine file another way fails" "$d" \
  "examples/demo/src/main.ts:2"
expect fail "an example importing the engine past its export fails" "$d" \
  "examples/demo/src/main.ts:3"

d="$(fixture require)"
mkdir -p "$d/examples/a"
echo 'const e = require("../../packages/comb/wasm/engine.js");' > "$d/examples/a/r.cjs"
expect fail "a require of the package outside the bridge fails" "$d" "examples/a/r.cjs:1: only"

d="$(fixture backticks)"
# shellcheck disable=SC2016 # the backticks are the TypeScript under test, not a substitution
echo 'const m = await import(`../../wasm/engine.js`);' >> "$d/packages/comb/src/store/index.ts"
# shellcheck disable=SC2016 # the backticks are the TypeScript under test, not a substitution
echo 'const i = await import(`comb/internal`);' >> "$d/examples/demo/src/main.ts"
expect fail "a backtick import outside the bridge fails" "$d" "packages/comb/src/store/index.ts:2"
expect fail "a backtick import past the library's entry fails" "$d" "examples/demo/src/main.ts:2"

d="$(fixture same-line)"
echo 'import t from "comb/testing"; import i from "comb/internal";' >> "$d/examples/demo/src/main.ts"
expect fail "an allowed import does not hide a forbidden one on its line" "$d" \
  "examples/demo/src/main.ts:2"

d="$(fixture renamed-core)"
printf '[package]\nname = "comb-core"\n\n[dependencies]\n' > "$d/crates/engine/Cargo.toml"
expect fail "a lock without the core's crate fails" "$d" 'no package named "comb-core"'

d="$(fixture generated)"
mkdir -p "$d/packages/comb/dist" "$d/packages/comb/wasm" "$d/examples/demo/node_modules/x"
echo 'import "../wasm/engine.js";' > "$d/packages/comb/dist/index.js"
echo 'import * as m from "./engine_bg.js";' > "$d/packages/comb/wasm/engine.js"
echo 'import "comb/inner";' > "$d/examples/demo/node_modules/x/index.js"
expect pass "generated output and dependencies are not read" "$d"

d="$(fixture render-text)"
echo 'import { Text } from "pixi.js";' >> "$d/packages/comb/src/render/scene.ts"
expect fail "the render layer naming Text fails" "$d" "packages/comb/src/render/scene.ts:2"

d="$(fixture render-html-text)"
echo 'const t = new HTMLText({ text: "x" });' >> "$d/packages/comb/src/render/scene.ts"
expect fail "the render layer naming HTMLText fails" "$d" "never as Text, HTMLText"

d="$(fixture render-split-text)"
echo 'import { SplitText } from "pixi.js";' >> "$d/packages/comb/src/render/scene.ts"
expect fail "the render layer naming SplitText fails" "$d" "never as Text, HTMLText"

d="$(fixture render-bitmap-text)"
echo 'import { BitmapText, Graphics, SplitBitmapText } from "pixi.js";' \
  >> "$d/packages/comb/src/render/scene.ts"
expect pass "BitmapText, and Graphics outside the edges layer, pass" "$d"

d="$(fixture edges-graphics)"
echo 'import { Graphics } from "pixi.js";' >> "$d/packages/comb/src/render/edges.ts"
expect fail "the edges layer naming Graphics fails" "$d" "packages/comb/src/render/edges.ts:2"

# fallback <dir> — the Canvas 2D fallback of the edges layer, one drawing; prints its file.
fallback() {
  local f="$1/packages/comb/src/render/edges-canvas.ts"
  cat > "$f" <<'TS'
import { Graphics } from "pixi.js";
export class EdgeFill {
  readonly drawing = new Graphics();
  fill(points: number[][]): void {
    for (const p of points) this.drawing.poly(p).fill(0);
  }
}
TS
  echo "$f"
}

d="$(fixture fallback)"
fallback "$d" > /dev/null
expect pass "a fallback filling one Graphics field passes" "$d"

d="$(fixture fallback-loop)"
f="$(fallback "$d")"
echo 'for (const e of edges) { const g = new Graphics(); }' >> "$f"
expect fail "a fallback creating a Graphics in a loop fails" "$d" "edges-canvas.ts:8: the Canvas"

d="$(fixture fallback-extends)"
f="$(fallback "$d")"
echo 'export class EdgeView extends Graphics {}' >> "$f"
expect fail "a fallback extending Graphics fails" "$d" "edges-canvas.ts:8: the Canvas"

d="$(fixture fallback-import-line)"
f="$(fallback "$d")"
echo 'import { Container } from "pixi.js"; const g = new Graphics();' >> "$f"
expect fail "an import does not hide a Graphics on its line" "$d" "edges-canvas.ts:8: the Canvas"

d="$(fixture fallback-multi-line-import)"
f="$(fallback "$d")"
printf 'import {\n  Container,\n  Graphics,\n} from "pixi.js";\n' > "$d/x.ts"
cat "$d/x.ts" "$f" > "$d/y.ts" && mv "$d/y.ts" "$f"
expect pass "a fallback importing Graphics over several lines passes" "$d"

d="$(fixture fallback-alias)"
f="$(fallback "$d")"
echo 'import { Graphics as Drawing } from "pixi.js";' >> "$f"
expect fail "a fallback renaming Graphics on import fails" "$d" "edges-canvas.ts:8: the Canvas"

d="$(fixture fallback-alias-multi-line)"
f="$(fallback "$d")"
printf 'import {\n  Graphics as Drawing,\n} from "pixi.js";\n' >> "$f"
expect fail "a fallback renaming Graphics in a multi-line import fails" "$d" \
  "edges-canvas.ts:9: the Canvas"

d="$(fixture fallback-after-import)"
f="$(fallback "$d")"
printf 'import {\n  Container,\n} from "pixi.js"; const g = new Graphics();\n' >> "$f"
expect fail "the end of a multi-line import does not hide a Graphics" "$d" \
  "edges-canvas.ts:10: the Canvas"

d="$(fixture fallback-two-fields)"
f="$(fallback "$d")"
echo 'class Second { readonly other = new Graphics(); }' >> "$f"
printf 'class Third {\n  readonly other = new Graphics();\n}\n' >> "$f"
expect fail "a fallback with two Graphics fields fails" "$d" "one Graphics field, found 2"

d="$(fixture fallback-no-field)"
printf 'import { Mesh } from "pixi.js";\n' > "$d/packages/comb/src/render/edges-canvas.ts"
expect fail "a fallback without its Graphics field fails" "$d" "one Graphics field, found 0"

d="$(fixture edges-missing)"
rm "$d/packages/comb/src/render/edges.ts"
expect fail "a render layer without its edges layer fails" "$d" "edges.ts: missing"

if ((failed)); then
  echo "Structure check self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Structure check self-test passed ($passed cases)."
