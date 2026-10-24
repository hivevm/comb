#!/usr/bin/env bash
#
# The overview names every entry point of Comb (ADR-0001, AGENTS.md §5).
#
# docs/ARCHITECTURE.md is believed, so a method a host application calls or a probe a test reads
# that it does not name is a part of the system a reader does not know is there. This check reads
# the names from the sources: each method and property of the `Comb` interface and each option of
# `CombOptions` in packages/comb/src/api/index.ts, and each function or constant
# packages/comb/src/testing.ts exports, by declaration or by name in `export { … }`, under the
# name it is exported as; and fails, naming each, where the overview holds no code span that is
# that name, on its own or after a qualifier (`CombOptions.canDelete`) or before its arguments
# (`inspect(comb)`). A span may wrap a line; one in a fenced block or an HTML comment does not
# count. A source it reads no names from fails rather than pass, as one it cannot find does, and
# so does an export of testing.ts of a shape it does not read. A stale sentence about a
# name the overview holds is review. The engine's buffer accessors stay out of it: the overview
# names the buffers, not each accessor.
#
# Pure bash and POSIX awk.
#
# Usage:
#     scripts/check-overview.sh [repository root]
# The root defaults to this repository; scripts/test-check-overview.sh passes fixture trees.
# Exit code 0 when the overview names every entry point, 1 otherwise.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API="$ROOT/packages/comb/src/api/index.ts"
TESTING="$ROOT/packages/comb/src/testing.ts"
OVERVIEW="$ROOT/docs/ARCHITECTURE.md"

fail() {
  echo "Overview check FAILED (ADR-0001): $1" >&2
  exit 1
}

for file in "$API" "$TESTING" "$OVERVIEW"; do
  [[ -f "$file" ]] || fail "${file#"$ROOT/"} is missing, so nothing can be compared."
done

# A name of JavaScript, as awk matches it.
NAME='[A-Za-z_$][A-Za-z0-9_$]*'

# members <interface> — the names of the members of `export interface <interface>` (or `export
# type <interface> = {`) in the api, generics and `extends` allowed: each member at the
# interface's indentation of two spaces, a method, a getter, or a property, read-only or not;
# comments skipped.
members() {
  awk -v name="$1" -v id="$NAME" '
    { sub(/\r$/, "") }
    !inside && $0 ~ ("^export (interface|type) " name "([<[:space:]=]|$)") && /\{[[:space:]]*$/ {
      inside = 1; next
    }
    !inside { next }
    /^\}/ { exit }
    comment { if (/\*\//) comment = 0; next }
    /^[[:space:]]*\/\*/ { if (!/\*\//) comment = 1; next }
    /^[[:space:]]*\/\// { next }
    $0 ~ ("^  (readonly |get |set )?" id "[?]?[[:space:]]*[(:<]") {
      line = $0; sub(/^  (readonly |get |set )?/, "", line)
      match(line, id); print substr(line, RSTART, RLENGTH)
    }' "$API"
}

# exported — the functions and constants testing.ts exports: `export function` (async, `*`,
# `default`, `declare`), every `export const`, `let`, or `var`, which a probe may be whichever way
# it is written, and each name in `export { … }`, over lines too, by the name after `as` (by its
# own where that is `default`), `type` specifiers and comments left out. An `export` line of any
# other shape than these, a type, an interface, a class, or an enum prints `?` and the line, which
# fails the check: a shape it does not read is no name it may pass.
exported() {
  awk -v id="$NAME" '
    { sub(/\r$/, "") }
    list {
      line = $0; sub(/\/\/.*$/, "", line); block = block " " line
      if (index(line, "}")) { names(block); list = 0 }
      next
    }
    !/^export([[:space:]]|\{)/ { next }
    /^export[[:space:]]*\{/ {
      block = $0; sub(/\/\/.*$/, "", block)
      if (index(block, "}")) names(block); else list = 1
      next
    }
    $0 ~ ("^export (default |declare )?(async )?function[*]?[[:space:]]*" id) {
      line = $0; sub(/^export (default |declare )?(async )?function[*]?[[:space:]]*/, "", line)
      match(line, id); print substr(line, RSTART, RLENGTH); next
    }
    $0 ~ ("^export (declare )?(const|let|var) " id) {
      line = $0; sub(/^export (declare )?(const|let|var) /, "", line)
      match(line, id); print substr(line, RSTART, RLENGTH); next
    }
    /^export (declare )?(type|interface|(abstract )?class|enum|const enum)[[:space:]{]/ { next }
    { print "?" $0 }
    function names(text,    parts, n, i, spec, own) {
      sub(/^export[[:space:]]*\{/, "", text); sub(/\}.*$/, "", text)
      n = split(text, parts, ",")
      for (i = 1; i <= n; i++) {
        spec = parts[i]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", spec)
        if (spec == "" || spec ~ /^type[[:space:]]/) continue
        own = spec; sub(/[[:space:]].*$/, "", own)
        sub(/^.*[[:space:]]as[[:space:]]+/, "", spec)
        print (spec == "default" ? own : spec)
      }
    }' "$TESTING"
}

# named — every name the overview holds as a code span of its own: the span is the name, after a
# qualifier or before its arguments or both. Prose is joined by paragraph, a heading, a list item,
# a quote, or a fence beginning another, so that a span may wrap a line; an escaped backquote is
# no delimiter; and fenced blocks, closed by their own character at their length or more, and HTML
# comments, over lines too, count for nothing.
named() {
  awk -v id="$NAME" '
    { sub(/\r$/, "") }
    fence {
      if (match($0, /^[[:space:]]*(`+|~+)[[:space:]]*$/)) {
        mark = $0; gsub(/[[:space:]]/, "", mark)
        if (substr(mark, 1, 1) == substr(fence, 1, 1) && length(mark) >= length(fence)) fence = ""
      }
      next
    }
    {
      line = $0
      while (line != "") {
        if (comment) {
          if (!(at = index(line, "-->"))) { line = ""; break }
          line = substr(line, at + 3); comment = 0
        }
        if (!(at = index(line, "<!--"))) break
        kept = kept substr(line, 1, at - 1); line = substr(line, at + 4); comment = 1
      }
      line = kept line; kept = ""
    }
    comment && line ~ /^[[:space:]]*$/ { next }
    line ~ /^[[:space:]]*(```|~~~)/ {
      flush(); match(line, /(`+|~+)/); fence = substr(line, RSTART, RLENGTH); next
    }
    line ~ /^[[:space:]]*$/ { flush(); next }
    # A heading is a paragraph of its own line.
    line ~ /^[[:space:]]*#+[[:space:]]/ { flush(); text = line; flush(); next }
    line ~ /^[[:space:]]*([-*+][[:space:]]|[0-9]+[.)][[:space:]]|>)/ { flush() }
    { text = text " " line }
    END { flush() }
    function flush(    rest, span, at) {
      gsub(/\\`/, "", text)
      rest = text
      while ((at = index(rest, "`"))) {
        rest = substr(rest, at + 1)
        if (!(at = index(rest, "`"))) break
        span = substr(rest, 1, at - 1); rest = substr(rest, at + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", span)
        sub(/\(.*\)$/, "", span)
        if (span ~ ("^(" id "\\.)*" id "$")) { sub(/^.*\./, "", span); print span }
      }
      text = ""
    }' "$OVERVIEW"
}

mapfile -t spans < <(named | sort -u)
declare -A held
for span in "${spans[@]}"; do held["$span"]=1; done

missing=()
counted=0
# check <what> <source> — every name of <source>, which names at least one, is held.
check() {
  local what="$1" source="$2" name names
  names="$($source | sort -u)"
  [[ -n "$names" ]] || fail "read no $what from its source; its shape is not one this check knows."
  if [[ "$names" == *\?* ]]; then
    fail "$(grep -m1 '^?' <<< "$names" | cut -c2-) is an export of a shape this check does not read."
  fi
  while IFS= read -r name; do
    counted=$((counted + 1))
    [[ -n "${held[$name]:-}" ]] || missing+=("$what \`$name\`")
  done <<< "$names"
}

check "Comb method or property" "members Comb"
check "CombOptions option" "members CombOptions"
check "comb/testing export" exported

if ((${#missing[@]})); then
  echo "Overview check FAILED (ADR-0001): docs/ARCHITECTURE.md names none of these in a code span:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi
echo "Overview check passed ($counted entry points named)."
