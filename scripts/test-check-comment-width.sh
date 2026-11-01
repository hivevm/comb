#!/usr/bin/env bash
#
# Self-test of scripts/check-comment-width.sh.
#
# Decides no ADR clause and no criterion: a check of the kind AGENTS.md §5 asks for where a
# mistake could have been caught, a comment line review found wider than the 100 columns the code
# and the documents are held to.
#
# Each case builds a git repository in a temporary directory with a Rust source in git's index and
# a TypeScript source not yet in it, whose comments fit, adds one line, runs the check on it, and
# asserts the exit code and a line it prints. A comment line of 101 columns fails naming the file
# and the line, in either language, as a line comment, a doc comment, the line that opens a block
# comment, and a line inside one, also as the last line without a final newline and in a file whose
# name holds a character beyond ASCII; one of 100 columns passes, an em dash counted as one column.
# A URL or a Markdown link standing on a line of its own passes, in a line comment and in a block
# comment, and a URL with prose after it fails. A code line, a comment after code, and a string
# literal over 100 columns pass, as does a code line after a block comment closed on the line that
# opens it or on a later one, and a file git ignores or marks 'linguist-generated'; a file marked
# not generated is read. A directory that is no git repository fails, as does a repository where
# git lists no `.rs` file or no `.ts` file.
#
# Usage:
#     scripts/test-check-comment-width.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-comment-width.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

# repo <name> — a repository with src/lib.rs, staged, and src/index.ts, new, whose comments fit;
# prints its path.
repo() {
  local dir="$work/$1"
  mkdir -p "$dir/src"
  git -C "$dir" init -q
  printf '/// Adds one.\npub fn add(a: u8) -> u8 {\n    a + 1 // short\n}\n' > "$dir/src/lib.rs"
  printf '/** Adds one. */\nexport const add = (a: number) => a + 1; // short\n' > "$dir/src/index.ts"
  git -C "$dir" add src/lib.rs
  echo "$dir"
}

# words_of <n> — n characters of prose, words of four letters and a space.
words_of() { local s=""; while ((${#s} < $1)); do s+="word "; done; printf '%s' "${s:0:$1}"; }

# line <prefix> <n> — <prefix> followed by prose, n characters in all.
line() { printf '%s%s' "$1" "$(words_of $(($2 - ${#1})))"; }

# expect <name> <exit code> <needle> <root> — run the check; it must exit with the code and print
# the needle.
expect() {
  local name="$1" code="$2" needle="$3" root="$4"
  local out rc
  out="$(bash "$CHECK" "$root" 2>&1)"; rc=$?
  if ((rc == code)) && [[ "$out" == *"$needle"* ]]; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected exit $code with \"$needle\", exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

d="$(repo baseline)"
expect "comments that fit" 0 "every comment line of 1 Rust and 1 TypeScript files fits" "$d"

# One case per comment of 101 columns, and the same of 100 columns, each the file's last line.
for c in "rs:// " "rs:/// " "rs://! " "rs:    // " "ts:// " "ts:  /** " "ts:/* "; do
  ext="${c%%:*}" prefix="${c#*:}" name="${c//[^a-z]/-}"
  file="src/lib.rs:5"; [[ "$ext" == ts ]] && file="src/index.ts:3"
  for width in 101 100; do
    d="$(repo "comment-$width$name")"
    line "$prefix" "$width" >> "$d/${file%:*}"; echo >> "$d/${file%:*}"
    [[ "$prefix" == *"/*"* ]] && echo " */" >> "$d/${file%:*}"
    if ((width == 101)); then
      expect "a .$ext comment '$prefix' of 101 columns" 1 "$file: 101 columns — wrap the comment" "$d"
    else
      expect "a .$ext comment '$prefix' of 100 columns" 0 "passed" "$d"
    fi
  done
done

d="$(repo block-inside-ts)"
{ echo "/**"; line " *  " 101; echo; echo " */"; } >> "$d/src/index.ts"
expect "a line inside a .ts block comment of 101 columns" 1 "src/index.ts:4: 101 columns" "$d"

d="$(repo block-inside-rs)"
{ echo "/* Opens here."; line "   " 101; echo; echo "*/"; } >> "$d/src/lib.rs"
expect "a line inside a .rs block comment without a star" 1 "src/lib.rs:6: 101 columns" "$d"

d="$(repo last-line)"
line "// " 101 >> "$d/src/index.ts"
expect "a comment of 101 columns as the last line, without a final newline" 1 \
  "src/index.ts:3: 101 columns" "$d"

d="$(repo non-ascii-name)"
line "// " 101 > "$d/src/ä.ts"; echo >> "$d/src/ä.ts"
expect "a file whose name holds a character beyond ASCII" 1 "src/ä.ts:1: 101 columns" "$d"

d="$(repo dashes)"
printf '// %s — %s\n' "$(words_of 47)" "$(words_of 47)" >> "$d/src/index.ts"
expect "an em dash counts as one column" 0 "passed" "$d"

d="$(repo url)"
printf '// https://example.invalid/%s\n' "$(words_of 100 | tr ' ' x)" >> "$d/src/index.ts"
printf '    /// [the long link](https://example.invalid/%s)\n' "$(words_of 100 | tr ' ' x)" >> "$d/src/lib.rs"
printf '/**\n *  https://example.invalid/%s */\n' "$(words_of 100 | tr ' ' x)" >> "$d/src/index.ts"
expect "a URL or a link standing on a line of its own" 0 "passed" "$d"

d="$(repo url-then-prose)"
printf '// https://example.invalid/%s and prose that could wrap\n' "$(words_of 100 | tr ' ' x)" \
  >> "$d/src/index.ts"
expect "prose after a long URL can wrap" 1 "src/index.ts:3:" "$d"

d="$(repo code)"
{
  printf 'export const s = "// %s";\n' "$(words_of 110)"
  printf 'export const t = 1; // %s\n' "$(words_of 110)"
  printf '/* closed */\nexport const u = [%s];\n' "$(words_of 110 | tr ' ' ,)"
  printf '/*\n * closed\n */\nexport const v = [%s];\n' "$(words_of 110 | tr ' ' ,)"
} >> "$d/src/index.ts"
printf 'pub const S: &str = "%s";\n' "$(words_of 110)" >> "$d/src/lib.rs"
expect "a code line, a comment after code, and a string literal" 0 "passed" "$d"

d="$(repo ignored)"
mkdir -p "$d/target" "$d/gen"
echo "target/" > "$d/.gitignore"
line "// " 120 > "$d/target/out.rs"; echo >> "$d/target/out.rs"
line "// " 120 > "$d/gen/out.ts"; echo >> "$d/gen/out.ts"
echo "gen/out.ts linguist-generated" > "$d/.gitattributes"
expect "a file git ignores or marks as generated" 0 "passed" "$d"

d="$(repo generated-unset)"
mkdir -p "$d/gen"
line "// " 120 > "$d/gen/out.ts"; echo >> "$d/gen/out.ts"
echo "gen/out.ts -linguist-generated" > "$d/.gitattributes"
expect "a file marked not generated is read" 1 "gen/out.ts:1: 120 columns" "$d"

d="$(repo no-rust)"
rm "$d/src/lib.rs"
expect "a repository with no .rs file" 1 "no .rs file" "$d"

d="$(repo no-typescript)"
rm "$d/src/index.ts"
expect "a repository with no .ts file" 1 "no .ts file" "$d"

mkdir -p "$work/no-repository"
cp "$work/baseline/src/"* "$work/no-repository/"
expect "a directory that is no git repository" 1 "not a git repository" "$work/no-repository"

if ((failed)); then
  echo "Comment width check self-test: $passed passed, $failed failed." >&2
  exit 1
fi
echo "Comment width check self-test: $passed passed, 0 failed."
