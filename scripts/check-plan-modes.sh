#!/usr/bin/env bash
#
# Plan modes check: an unattended ticket names no protected part.
#
# ADR-0007 keeps its protected parts with the maintainer, and .github/CODEOWNERS names them. This
# check is the project's own rule beside that ADR: it decides the paths a ticket names, not what
# the work touches. It reads the protected patterns from .github/CODEOWNERS, the first field of
# every line that is neither blank nor a comment, and fails, naming the file, when it reads none.
# It then reads every ticket under docs/plan/, a file docs/plan/<spec>/<NN>-<slug>.md, as
# scripts/sensor-plan-frontier.sh does, with HTML comments removed. A ticket whose 'Mode' begins
# with 'unattended' fails when its 'What to build' or its 'Acceptance criteria' names a path that
# a protected pattern covers, and the failure names the ticket, the path, and the pattern. 'Read
# first' is not read, because reading a part does not touch it. A ticket without a 'Mode' is left
# to the plan frontier sensor, which fails on it.
#
# A path is a run of letters, digits, and '._/*-', read from the repository root; a leading '/'
# or './' is dropped, and one that starts with '../', such as a link, is resolved from the
# ticket's directory. A pattern follows the gitignore rules CODEOWNERS uses: a '/' at its start or
# in its middle anchors it to the root, a '*' matches within one path segment and '**' across
# segments, and a pattern covers the path it names and everything below it.
#
# Pure bash + coreutils/awk. Usage:
#     scripts/check-plan-modes.sh [repository root]
# The root defaults to this repository; scripts/test-check-plan-modes.sh passes fixtures.
# Exit code 0 when the check passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd)"
PLAN="docs/plan"
OWNERS=".github/CODEOWNERS"

# section <file> <heading> — the lines of a '## <heading>' section, HTML comments removed;
# prints nothing and returns 1 when the section is missing.
section() {
  awk -v want="## $2" '
    /^## / { inside = ($0 == want); if (inside) found = 1; next }
    !inside { next }
    {
      line = $0; out = ""
      while (line != "") {
        if (comment) {
          end = index(line, "-->"); if (!end) { line = ""; break }
          line = substr(line, end + 3); comment = 0
        } else {
          start = index(line, "<!--"); if (!start) { out = out line; line = ""; break }
          out = out substr(line, 1, start - 1); line = substr(line, start + 4); comment = 1
        }
      }
      print out
    }
    END { exit !found }' "$1"
}

# to_regex <pattern> — the extended regular expression of a CODEOWNERS pattern, matched against a
# path from the root without a leading or trailing '/'.
to_regex() {
  local p="$1" anchored=0 body="" i c
  p="${p%/}"
  [[ "$p" == /* || "$p" == */* ]] && anchored=1
  p="${p#/}"
  for ((i = 0; i < ${#p}; i++)); do
    c="${p:i:1}"
    if [[ "$c" == "*" && "${p:i+1:1}" == "*" ]]; then
      body+=".*"; i=$((i + 1))
    elif [[ "$c" == "*" ]]; then
      body+="[^/]*"
    elif [[ "$c" == "?" ]]; then
      body+="[^/]"
    elif [[ "$c" =~ [A-Za-z0-9/_-] ]]; then
      body+="$c"
    else
      body+="\\$c"
    fi
  done
  if ((anchored)); then
    printf '^%s(/.*)?$' "$body"
  else
    printf '(^|/)%s(/.*)?$' "$body"
  fi
}

if [[ ! -f "$ROOT/$OWNERS" ]]; then
  echo "Plan modes check: $OWNERS not found — the protected parts of ADR-0007 are unreadable." >&2
  exit 1
fi
patterns=() regexes=()
while read -r p _; do
  [[ -z "$p" || "$p" == \#* ]] && continue
  patterns+=("$p")
  regexes+=("$(to_regex "$p")")
done < "$ROOT/$OWNERS"
if ((${#patterns[@]} == 0)); then
  echo "Plan modes check: $OWNERS names no pattern — the protected parts of ADR-0007 are unreadable." >&2
  exit 1
fi

tickets=()
if [[ -d "$ROOT/$PLAN" ]]; then
  while IFS= read -r f; do tickets+=("${f#"$ROOT"/}"); done \
    < <(find "$ROOT/$PLAN" -mindepth 2 -maxdepth 2 -type f -name '[0-9][0-9]-*.md' | LC_ALL=C sort)
fi

errors=()
unattended=0
for t in ${tickets[@]+"${tickets[@]}"}; do
  mode="$(section "$ROOT/$t" "Mode")" || continue
  mode="$(awk 'NF { print; exit }' <<< "$mode")"
  [[ "$mode" == unattended* ]] || continue
  unattended=$((unattended + 1))
  text="$(section "$ROOT/$t" "What to build"; section "$ROOT/$t" "Acceptance criteria")"
  seen=" "
  while IFS= read -r path; do
    if [[ "$path" == ../* ]]; then
      dir="${t%/*}"
      while [[ "$path" == ../* ]]; do
        path="${path#../}"
        [[ "$dir" == */* ]] && dir="${dir%/*}" || dir=""
      done
      path="${dir:+$dir/}$path"
    fi
    while [[ "$path" == /* || "$path" == ./* ]]; do path="${path#/}"; path="${path#./}"; done
    while [[ "$path" == */ || "$path" == *. ]]; do path="${path%/}"; path="${path%.}"; done
    [[ -n "$path" && "$seen" != *" $path "* ]] || continue
    seen+="$path "
    for i in "${!patterns[@]}"; do
      if [[ "$path" =~ ${regexes[i]} ]]; then
        errors+=("$t: unattended, but names '$path', which '${patterns[i]}' of $OWNERS protects — work it with the human, or leave the path out")
        break
      fi
    done
  done < <(grep -oE '[A-Za-z0-9._/*-]+' <<< "$text")
done

if ((${#errors[@]})); then
  echo "Plan modes check: ${#errors[@]} protected path(s) named by unattended tickets (ADR-0007):" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  exit 1
fi
echo "Plan modes check: ${#tickets[@]} ticket(s) read, $unattended unattended, none names a protected part."
exit 0
