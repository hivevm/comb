#!/usr/bin/env bash
#
# Sensor: the ADRs that bind a change (ADR-0001, AGENTS.md section 2).
#
# Lists the ADRs in force — accepted or proposed — whose '**Applies to:**' line names a path a
# change touches. A path is what that line writes in backticks with no space in it, such as
# `docs/plan/`, `README.md`, or `Makefile`; it names itself and everything under it, and a file of
# a language that lays out a module's children in the directory of the file's name names that
# directory too (MODULE_DIRS below): a Rust file `x.rs` names `x/`, so that a module split off a
# file stays bound by the ADRs that name the file. A word in
# backticks that is no path, such as a skill's name, matches no changed path unless one carries
# that name, so it needs no filter. The rest of the line is prose no script reads ("every
# accepted ADR", "the pull request template"), so the list is the ADRs a session reads at the
# least, not all it reads: the index is still read by its prose. A path stands for the whole
# file even where the ADR governs a part of it, such as one section of the README, so the list
# also names an ADR whose part the change did not touch. It reports and never fails, so that the
# implementing session and the reviewer of AGENTS.md section 5 start from the same list.
#
# Pure bash + git. Usage:
#     scripts/sensor-binding-adrs.sh [--root <dir>] [base [head]]
# It reads the repository it lives in, as the checks do; --root names another, as its self-test
# does with each fixture.
# Without a base, the merge base of head with origin/main (else main) is used; CI passes the
# pull request's base. A base of zeros, which a push event reports for a new branch, counts as
# none. Without a head, the change is the working tree, uncommitted and untracked files
# included, and the ADRs are read as the working tree has them, so a session gets its list
# before its first commit; with a head, the change ends at that commit and the ADRs are read as
# it has them. With nothing to compare — no base and no main, or no change — it says so. Exit
# code 0 always, except 2 on a base or head that does not resolve.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/adr.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/adr.sh"
# shellcheck source-path=SCRIPTDIR source=lib/git.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/git.sh"

enter_root "Binding ADRs sensor" "${BASH_SOURCE[0]}" "$@"
shift "$ROOT_TAKEN"

# MODULE_DIRS — per language that lays out a module's children in the directory of its file's
# name, the extension and the file names that do not, '<extension> <name>...' a line. Rust's
# lib.rs, main.rs, and mod.rs have their children beside them, and build.rs is no module.
MODULE_DIRS='rs lib.rs main.rs mod.rs build.rs'

# module_dir <path> — the directory that holds the children of the module in the file, with its
# trailing slash, by MODULE_DIRS; fails for a path that names none.
module_dir() {
  local name="${1##*/}" ext excluded
  [[ "$name" == ?*.* ]] || return 1
  while read -r ext excluded; do
    [[ "${name##*.}" == "$ext" ]] || continue
    [[ " $excluded " == *" $name "* ]] && return 1
    printf '%s/' "${1%.*}"
    return 0
  done <<< "$MODULE_DIRS"
  return 1
}

base="${1:-}"
head="${2:-}"
worktree=0
if [[ -z "$head" ]]; then
  head=HEAD
  worktree=1
fi

[[ "$base" =~ ^0+$ ]] && base=""
[[ -n "$base" ]] || base="$(main_merge_base "$head")"
if [[ -z "$base" ]]; then
  echo "Binding ADRs sensor: nothing to compare — no base given and no main to compare with."
  exit 0
fi
for ref in "$base" "$head"; do
  git rev-parse --verify -q "$ref^{commit}" >/dev/null \
    || { echo "Binding ADRs sensor: '$ref' does not resolve to a commit." >&2; exit 2; }
done

# git quotes a path with bytes outside ASCII unless told not to, and a quoted path matches
# nothing an ADR writes.
changed=()
while IFS= read -r p; do [[ -n "$p" ]] && changed+=("$p"); done < <(
  if ((worktree)); then
    git -c core.quotePath=false diff --name-only --no-renames "$base"
    git -c core.quotePath=false ls-files --others --exclude-standard
  else
    git -c core.quotePath=false diff --name-only --no-renames "$base" "$head"
  fi | LC_ALL=C sort -u)

short_base="$(git rev-parse --short "$base")"
range="$short_base..$(git rev-parse --short "$head")"
((worktree)) && range="$short_base..working tree"
if ((${#changed[@]} == 0)); then
  echo "Binding ADRs sensor ($range): nothing to compare — no path changed."
  exit 0
fi

# show <path> — a file as the change has it.
show() { if ((worktree)); then cat -- "$1"; else git show "$head:$1"; fi; }

# The ADRs as the change has them: one that adds an ADR or flips one is read with its own record.
if ((worktree)); then
  adrs="$(adr_files docs/adr 2>/dev/null)"
else
  adrs="$(git ls-tree -r --name-only "$head" -- docs/adr/ | grep -E "^docs/adr/([0-9]{4}-[^/]*|draft-[^/]*)\\.md\$")"
fi

found=()
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  text="$(show "$file")"
  status="$(adr_field_line - Status <<< "$text")"
  [[ "$status" == *"🟢"* || "$status" == *"🟡"* ]] || continue
  applies="$(adr_field_line - 'Applies to' <<< "$text")"
  paths=()
  # shellcheck disable=SC2016  # the backticks are Markdown to match, not a command substitution
  while IFS= read -r token; do
    [[ "$token" =~ ^[^[:space:]]+$ ]] && paths+=("${token%/}")
  done < <(grep -oE '`[^`]+`' <<< "$applies" | tr -d '`')
  ((${#paths[@]})) || continue
  dirs=()
  for p in "${paths[@]}"; do dirs+=("$(module_dir "$p")"); done
  hits=()
  for c in "${changed[@]}"; do
    for i in "${!paths[@]}"; do
      p="${paths[$i]}" dir="${dirs[$i]}"
      if [[ "$c" == "$p" || "$c" == "$p/"* || ( -n "$dir" && "$c" == "$dir"* ) ]]; then
        hits+=("$c")
        break
      fi
    done
  done
  ((${#hits[@]})) || continue
  id="ADR-$(adr_key "$file")"
  more=""
  ((${#hits[@]} > 3)) && more=", and $((${#hits[@]} - 3)) more"
  found+=("$id ($file) — ${hits[*]:0:3}$more")
done <<< "$adrs"

if ((${#found[@]} == 0)); then
  echo "Binding ADRs sensor ($range): ${#changed[@]} path(s) changed; no ADR in force names one of them. Read the index for the ADRs whose Applies to is prose."
  exit 0
fi
echo "Binding ADRs sensor ($range): ${#changed[@]} path(s) changed; ${#found[@]} ADR(s) in force name one of them. Read these, and the index for the ADRs whose Applies to is prose:"
printf '  - %s\n' "${found[@]}"
exit 0
