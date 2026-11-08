#!/usr/bin/env bash
#
# Sensor: citations of a superseded ADR (AGENTS.md section 2 — superseded ADRs are not rules).
#
# Lists every line outside docs/adr/ that cites a superseded ADR, one whose '**Status:**' line in
# docs/adr/ carries the legend's ⚪, with the successor that line names. A superseded ADR still
# explains why, so a line that tells the history of a decision cites it rightly; a line that cites
# it for a rule in force sends the reader to an ADR that binds nothing, and wants its successor
# instead. Which of the two a line is, no script can tell, so the sensor reports and never fails:
# the reviewer of AGENTS.md section 5 judges each line, after each supersession above all.
#
# A citation is 'ADR-' and the number of a superseded ADR, not followed by another digit, in a
# text file of the working tree that git tracks or would track, so that a session sees its new
# files before its first commit; docs/adr/ is left out, since the record cites its superseded ADRs
# by design.
#
# Pure bash + git. Usage:
#     scripts/sensor-superseded-citations.sh [--root <dir>]
# It reads the repository it lives in, as the checks do; --root names another, as its self-test
# does with each fixture. Exit code 0 always, except 2 on a --root that is no directory, or on a
# repository git cannot read: a sensor that reads nothing would report nothing, and look clean.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/git.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/git.sh"
# shellcheck source-path=SCRIPTDIR source=lib/adr.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/adr.sh"

NAME="Superseded citations sensor"
enter_root "$NAME" "${BASH_SOURCE[0]}" "$@"

ADR_DIR=docs/adr

# The superseded ADRs, each as its identifier and the successor its status line names.
superseded=()
declare -A successor=()
if [[ -d "$ADR_DIR" ]]; then
  while IFS= read -r f; do
    status="$(adr_field_line "$f" Status)"
    [[ "$status" == *"⚪"* ]] || continue
    id="ADR-$(adr_key "$f")"
    superseded+=("$id")
    successor["$id"]="$(grep -oE "$ADR_REF_RE" <<< "$status" | head -n1)"
  done < <(adr_files "$ADR_DIR")
fi

if ((${#superseded[@]} == 0)); then
  echo "$NAME: nothing to report — no ADR in $ADR_DIR/ is superseded."
  exit 0
fi

findings=()
for id in "${superseded[@]}"; do
  by="${successor[$id]:-no successor named}"
  # git grep exits 1 when nothing matches and above 1 when it could not read the tree.
  hits="$(git -c core.quotePath=false grep --untracked -n -I -E "$id([^0-9]|$)" \
            -- . ":(exclude)$ADR_DIR/")"
  rc=$?
  if ((rc > 1)); then
    echo "$NAME: could not read the tree of '$PWD' for $id (git grep exit $rc)." >&2
    exit 2
  fi
  [[ -n "$hits" ]] || continue
  while IFS= read -r hit; do
    # 'path:line:text' — the text with its indentation dropped.
    loc="${hit%%:*}"; rest="${hit#*:}"
    loc="$loc:${rest%%:*}"; text="${rest#*:}"
    text="${text#"${text%%[![:space:]]*}"}"
    findings+=("$loc: $id (superseded by $by): $text")
  done <<< "$hits"
done

if ((${#findings[@]} == 0)); then
  echo "$NAME: nothing to report — no line outside $ADR_DIR/ cites ${superseded[*]}."
  exit 0
fi
echo "$NAME: ${#findings[@]} citation(s) of a superseded ADR outside $ADR_DIR/ for the" \
  "reviewer — each tells history or wants its successor (AGENTS.md, section 2):"
printf '  - %s\n' "${findings[@]}"
exit 0
