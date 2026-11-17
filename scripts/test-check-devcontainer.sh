#!/usr/bin/env bash
#
# Self-test of scripts/check-devcontainer.sh.
# Verifies: NUC-container-hides-host-daemon, DEV-gh-login-outlives-rebuild
#
# Each case builds a fixture under a temporary directory — a devcontainer.json with comments and
# one pinned Feature and the postStartCommand that enables the git hooks, the lock that resolves
# it, and the editor settings that pin the container-management extension to the host — runs the
# check against it, and asserts the exit code and, for a failing case, the message that names the
# violation. The cases stand in scripts/fixtures/check-devcontainer.txt, which says its format, so
# that a port of the check is held to them: the baseline passes, what binds when the project has
# no Dev Container or no VS Code settings, and the cases that break one clause of
# NUC-container-hides-host-daemon each, a socket mount also in a config longer than a pipe holds.
# Comb's container also keeps its GitHub login (DEV-gh-login-outlives-rebuild): every fixture
# carries the mount, the initializeCommand, and 'gh auth setup-git --force' of the repository's own,
# a postStartCommand a case of the template's table writes gains the last, and the cases of
# scripts/fixtures/check-devcontainer-gh-login.txt break one part each.
# Each table is read twice, the second time against a copy of the check that rewords its messages,
# and the reader of the table is checked on fields of its own.
#
# Inputs: scripts/check-devcontainer.sh scripts/lib/ scripts/fixtures/check-devcontainer.txt
#   scripts/fixtures/check-devcontainer-gh-login.txt
#
# Usage:
#     scripts/test-check-devcontainer.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/selftest.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/selftest.sh"
CHECK="$ROOT/scripts/check-devcontainer.sh"

# The postStartCommand that enables the git hooks and the merge settings and sets gh up as git's
# credential helper, as the repository's own writes it; config writes the value of post_start,
# none when it is empty.
DRIVER="merge.adr-index.driver '.githooks/merge-adr-index %O %A %B %S %X %Y'"
SETUP_GIT="gh auth setup-git --hostname github.com --force"
POST_START='{ "hooks": "git config core.hooksPath .githooks", "merge": "git config merge.ff false && git config pull.ff only", "index": "git config '"$DRIVER"'", "credentials": "'"$SETUP_GIT"'" }'
post_start="$POST_START"

# The mounts and the initializeCommand that keep the GitHub login on the host, as the
# repository's own write them; config writes the values of mounts and init, none when empty.
# shellcheck disable=SC2016  # the variables are devcontainer.json's, not the shell's
GH_SOURCE='${localEnv:HOME}${localEnv:USERPROFILE}/.config/gh'
GH_TARGET='/home/vscode/.config/gh'
GH_MOUNT="source=$GH_SOURCE,target=$GH_TARGET,type=bind"
# shellcheck disable=SC2016  # the variables are devcontainer.json's, not the shell's
MOUNTS='[ "source=${localEnv:HOME}${localEnv:USERPROFILE}/.claude,target=/home/vscode/.claude,type=bind", "'"$GH_MOUNT"'" ]'
# shellcheck disable=SC2016  # the variables are devcontainer.json's, not the shell's
INIT='"(mkdir \"${localEnv:HOME}${localEnv:USERPROFILE}/.config\" || cd .) && (mkdir \"'"$GH_SOURCE"'\" || cd .) && exit 0"'
mounts="$MOUNTS"
init="$INIT"

# config <dir> <feature id> [extra json lines...] — write devcontainer.json with one Feature, the
# mounts, initializeCommand, and postStartCommand that mounts, init, and post_start hold, and,
# before the features block, any extra top-level lines given.
config() {
  local dir="$1" feature="$2"; shift 2
  {
    echo '{'
    echo '  "name": "fixture",'
    echo '  // A comment: the container has no socket mount.'
    echo '  "image": "mcr.microsoft.com/devcontainers/base:debian",'
    [[ -z "$mounts" ]] || echo "  \"mounts\": $mounts,"
    [[ -z "$init" ]] || echo "  \"initializeCommand\": $init,"
    [[ -z "$post_start" ]] || echo "  \"postStartCommand\": $post_start,"
    printf '  %s\n' "$@"
    echo '  "features": {'
    echo '    // The one Feature.'
    echo "    \"$feature\": {}"
    echo '  },'
    echo '  "customizations": { "vscode": { "extensions": [] } }'
    echo '}'
  } > "$dir/.devcontainer/devcontainer.json"
}

# lock <dir> <feature ids...> — write devcontainer-lock.json resolving the given Features.
lock() {
  local dir="$1"; shift
  local id
  {
    echo '{'
    echo '  "features": {'
    for id in "$@"; do
      echo "    \"$id\": {"
      echo '      "version": "1.0.0",'
      echo '      "resolved": "example@sha256:0000",'
      echo '      "integrity": "sha256:0000"'
      echo '    },'
    done
    echo '  }'
    echo '}'
  } > "$dir/.devcontainer/devcontainer-lock.json"
}

# settings <dir> <extension kind json> — write .vscode/settings.json with the given block.
settings() {
  local dir="$1" kind="$2"
  {
    echo '{'
    echo '  // Keep the container-management extension on the host side.'
    echo "  \"remote.extensionKind\": $kind"
    echo '}'
  } > "$dir/.vscode/settings.json"
}

# repo <name> — a fixture that passes every check, printed as its path.
repo() {
  local dir="$work/$1"
  mkdir -p "$dir/.devcontainer" "$dir/.vscode"
  config "$dir" "ghcr.io/devcontainers/features/github-cli:1"
  lock "$dir" "ghcr.io/devcontainers/features/github-cli:1"
  settings "$dir" '{ "ms-azuretools.vscode-containers": ["ui"] }'
  echo "$dir"
}

# --- cases read from the fixture table ----------------------------------------------------

TABLE="$ROOT/scripts/fixtures/check-devcontainer.txt"
GH_TABLE="$ROOT/scripts/fixtures/check-devcontainer-gh-login.txt"

# with_setup_git <json> — the postStartCommand a case writes, with 'gh auth setup-git --force' of
# the repository's own added, so that the GitHub login holds where the case breaks something else:
# a member of an object, a command after a string's last, nothing where the case writes none.
with_setup_git() {
  case "$1" in
    "") echo "" ;;
    *\}) echo "${1%\}}, \"credentials\": \"$SETUP_GIT\" }" ;;
    \"*\") echo "${1%\"} && $SETUP_GIT\"" ;;
    *) echo "$1" ;;
  esac
}

# table_cases <prefix> <table> <add> — run each case of the table against $CHECK. The Feature, the
# extra lines, the mounts, the initializeCommand, and the postStartCommand of a case are kept, so
# that a step that writes devcontainer.json again keeps the changes of the steps before it. A post
# step gains 'gh auth setup-git --force' where <add> is 1.
table_cases() {
  local n=0 line want needle name tree s op arg d feature path text pad='<pad ([0-9]+)>'
  local -a extras ids
  while IFS= read -r line; do
    [[ "$line" =~ ^(pass|fail) ]] || continue
    n=$((n + 1))
    IFS=$'\x1f' read -r want needle name tree <<< "${line// | /$'\x1f'}"
    d="$(repo "$1-$n")"
    feature="ghcr.io/devcontainers/features/github-cli:1" extras=() post_start="$POST_START"
    mounts="$MOUNTS" init="$INIT"
    [[ "$tree" != - ]] || tree=""
    while IFS= read -r s; do
      [[ -n "$s" ]] || continue
      while [[ "$s" =~ $pad ]]; do
        s="${s/"${BASH_REMATCH[0]}"/"$(printf '%*s' "${BASH_REMATCH[1]}" '' | tr ' ' z)"}"
      done
      read -r op arg <<< "$s"
      case "$op" in
        rm) rm -r "${d:?}/$arg" ;;
        extra) extras+=("$arg") ;;
        post) post_start="$arg"; (($3)) && post_start="$(with_setup_git "$arg")" ;;
        mounts) mounts="$arg" ;;
        init) init="$arg" ;;
        feature) feature="$arg" ;;
        lock) read -r -a ids <<< "$arg"; lock "$d" "${ids[@]}" ;;
        settings) settings "$d" "$arg" ;;
        write)
          path="${arg%% *}" text="${s#write "${arg%% *}" }"
          mkdir -p "$(dirname "$d/$path")" && printf '%s' "${text//\\n/$'\n'}" > "$d/$path" ;;
        *) echo "fixture table: unknown step '$op'" >&2; exit 1 ;;
      esac
      case "$op" in extra | post | feature | mounts | init) config "$d" "$feature" "${extras[@]}" ;; esac
    done <<< "${tree//; /$'\n'}"
    post_start="$POST_START" mounts="$MOUNTS" init="$INIT"
    out="$(bash "$CHECK" --root "$d" 2>&1)"
    table_case "$name" "$want" "$needle" "$?" "$out"
  done < "$2"
  ((n > 0)) || { echo "FAIL: no case read from $2" >&2; failed=$((failed + 1)); }
}
table_cases table "$TABLE" 1
table_cases gh-login "$GH_TABLE" 0

# --- the key decides, not the wording ------------------------------------------------------

# Every message the table expects, reworded in a copy of the check, its keys and its data kept: the
# table still passes.
copy="$work/reworded/scripts"
mkdir -p "$copy"
cp -R "$ROOT/scripts/lib" "$copy/"
sed -E '/\[devcontainer\//s/ (a|is|no|not|the) / reworded /g' "$CHECK" > "$copy/check-devcontainer.sh"
keyed="$(grep -c '\[devcontainer/' "$CHECK")"
check "a copy of the check rewords each message with a key" \
  test "$keyed" -gt 0 -a "$keyed" -eq "$(grep -c ' reworded .*\[devcontainer/' "$copy/check-devcontainer.sh")"
CHECK="$copy/check-devcontainer.sh"
table_cases reworded "$TABLE" 1
table_cases reworded-gh-login "$GH_TABLE" 0

# holds and lacks <output> <field>, and refused <field> — what the reader of a table says of a
# field.
# shellcheck disable=SC2317,SC2329 # run by check
holds() { (table_holds "$1" "$2") 2>/dev/null; }
# shellcheck disable=SC2317,SC2329 # run by check
lacks() { ! holds "$@"; }
# shellcheck disable=SC2317,SC2329 # run by check
refused() { (table_holds "" "$1") 2>/dev/null; (($? == 2)); }
said=$'  - a.md:3: free words "some term" [area/rule-x:why]\n  - b.md: other words [area/rule-x:else]'
check "a key at the end of a line holds" holds "$said" "area/rule-x:why"
check "a key and the data of its line hold" holds "$said" 'area/rule-x:why @ a.md:3 @ "some term"'
check "'-' holds on anything" holds "$said" "-"
check "'!' holds where no line has the key" holds "$said" "!area/rule-x:gone"
check "'!' with a subject holds where the line with the key lacks it" holds "$said" "!area/rule-x:else @ a.md"
check "a key no line has does not hold" lacks "$said" "area/rule-x:gone"
check "a key inside a line does not hold" lacks "[area/rule-x:why] and more" "area/rule-x:why"
check "a subject on another line does not hold" lacks "$said" "area/rule-x:else @ a.md"
check "'!' does not hold where a line has the key" lacks "$said" "!area/rule-x:why"
check "subjects in the order of the field hold" holds "A then B [a/b:c]" "a/b:c @ A @ B"
check "subjects in the other order do not hold" lacks "B then A [a/b:c]" "a/b:c @ A @ B"
check "a subject named twice needs the line to name it twice" lacks "A [a/b:c]" "a/b:c @ A @ A"
check "a number inside a longer one does not hold" lacks "x 12 [a/b:c]" "a/b:c @ 2"
check "a name inside a longer hyphenated one does not hold" lacks "aa-rule a-rule-two [a/b:c]" "a/b:c @ a-rule"
check "a subject after a place that is no datum of its own holds" holds "xaaa aa [a/b:c]" "a/b:c @ aa"
check "a subject only in the key does not hold" lacks "  - broken [docs/links:broken]" "docs/links:broken @ docs"
check "'!' with subjects holds on a line with them in the other order" \
  holds "  - b.md, then a.md [docs/x:y]" "!docs/x:y @ a.md @ b.md"
check "'!' with subjects does not hold on a line with them in its order" \
  lacks "  - a.md, then b.md [docs/x:y]" "!docs/x:y @ a.md @ b.md"
check "a wording in the field is refused" refused "does not pin the extension"
check "a wording after a key is refused" refused "area/rule-x:why @ does not pin"
check "a rule without a reason word is refused" refused "area/rule-x"
(table_case "no key" fail - 1 "") 2>/dev/null
check "a failing case that names no key is refused" test "$?" -eq 2

# --- summary -------------------------------------------------------------------------------

summary "Dev Container self-test"
