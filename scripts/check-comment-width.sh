#!/usr/bin/env bash
#
# Comment width: a comment line of a Rust or TypeScript source is at most 100 columns, the width
# Prettier's `printWidth` (.prettierrc.json) holds the code to and check 15 of
# scripts/check-docs.sh holds Markdown prose to. Prettier and rustfmt on stable leave a comment as
# written, so without this check only review sees one that runs past.
#
# The files are every `.rs` and `.ts` file git lists, tracked or new and not ignored, so that
# node_modules/, target/, dist/, the engine wasm-pack writes into packages/comb/wasm/, and a
# session's .scratch/ stay out as git leaves them out; a file .gitattributes marks
# 'linguist-generated' is written by a tool and not read either.
#
# A comment line is, in both languages:
#   - a line whose first characters after its indentation are `//`, which takes in the doc
#     comments `///` and `//!`;
#   - a line whose first characters after its indentation are `/*`, which takes in `/**` and `/*!`,
#     and every line after it up to and including the one that holds `*/`.
# A comment after code on the same line is not read: the line is code, and its width is the
# formatter's. A string literal is code too, but one over lines, a template literal or a raw
# string, whose line begins with `//` or `/*` is read as a comment: the check reads lines, not
# the language.
#
# Columns are characters, not bytes, so an em dash is one column, as check 15 counts them. A line
# that cannot break passes, as in check 15: one whose text after the comment marker (and before a
# closing `*/`) holds no space outside its Markdown links, such as a URL standing on a line of its
# own.
#
# A root git cannot list, or one where it lists no `.rs` file or no `.ts` file, fails: a check
# that reads no file passes everything.
#
# Pure bash, coreutils, sed, and git.
#
# Usage:
#     scripts/check-comment-width.sh [repository root]
# The root defaults to this repository; scripts/test-check-comment-width.sh passes fixtures.
# Exit code 0 when every comment line fits, 1 otherwise.

set -uo pipefail

ROOT="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" 2>/dev/null && pwd)" \
  || { echo "Comment width check FAILED: '${1:-}' is not a directory." >&2; exit 1; }
LC_ALL=C.UTF-8
export LC_ALL

fail() {
  echo "Comment width check FAILED: $1" >&2
  exit 1
}

listed="$(git -C "$ROOT" ls-files --cached --others --exclude-standard -- '*.rs' '*.ts' 2>/dev/null)" \
  || fail "$ROOT is not a git repository — git lists the files the check reads."

files=()
rust=0 typescript=0
while IFS= read -r rel; do
  [[ -n "$rel" && -f "$ROOT/$rel" ]] || continue
  case "$(git -C "$ROOT" check-attr linguist-generated -- "$rel")" in
    *": set" | *": true") continue ;;
  esac
  files+=("$rel")
  case "$rel" in
    *.rs) rust=$((rust + 1)) ;;
    *.ts) typescript=$((typescript + 1)) ;;
  esac
done < <(sort -u <<< "$listed")

((rust)) || fail "git lists no .rs file under $ROOT, so no Rust comment is read."
((typescript)) || fail "git lists no .ts file under $ROOT, so no TypeScript comment is read."

errors=()

# can_break <line> — whether a comment line holds a space outside its links once its indentation,
# its comment marker, and a closing `*/` are taken off; a line that holds none cannot break.
can_break() {
  local body
  body="$(sed -E -e 's/^[[:space:]]*(\/\/+!?|\/\*+!?|\*+)?[[:space:]]*//' \
    -e 's/[[:space:]]*\*+\/[[:space:]]*$//' \
    -e ':a' -e 's/(\[[^] ]*) ([^]]*\]\()/\1_\2/' -e 'ta' <<< "$1")"
  [[ "$body" == *" "* ]]
}

for rel in "${files[@]}"; do
  n=0 block=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    comment=0
    if ((block)); then
      comment=1
      [[ "$line" == *"*/"* ]] && block=0
    elif [[ "$line" =~ ^[[:space:]]*// ]]; then
      comment=1
    elif [[ "$line" =~ ^[[:space:]]*/\* ]]; then
      comment=1
      [[ "${line#*/\*}" == *"*/"* ]] || block=1
    fi
    ((comment && ${#line} > 100)) || continue
    can_break "$line" \
      && errors+=("$rel:$n: ${#line} columns — wrap the comment at 100 (a URL that does not fit stands on a line of its own)")
  done < "$ROOT/$rel"
done

if ((${#errors[@]})); then
  echo "Comment width check FAILED:"
  printf '  - %s\n' "${errors[@]}"
  echo
  echo "${#errors[@]} comment line(s) wider than 100 columns."
  exit 1
fi

echo "Comment width check passed: every comment line of $rust Rust and $typescript TypeScript files fits in 100 columns."
