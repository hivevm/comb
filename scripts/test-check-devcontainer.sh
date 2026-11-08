#!/usr/bin/env bash
#
# Self-test of scripts/check-devcontainer.sh.
# Verifies: ADR-0004, ADR-draft-gh-login-outlives-a-rebuild
#
# Each case builds a fixture under a temporary directory — a devcontainer.json with comments and
# one pinned Feature, the mount of the host's ~/.config/gh with the initializeCommand that creates
# its source, and the postStartCommand that enables the git hooks and sets gh up as git's
# credential helper, the lock that resolves it, and the editor settings that pin the
# container-management extension to the host — runs the check against it, and asserts the exit
# code and, for a failing case, the message that names the violation. The baseline passes; every
# other case breaks one thing ADR-0004 decides, drops a git setting from the postStartCommand, or
# breaks one part of the GitHub login ADR-draft-gh-login-outlives-a-rebuild keeps. The mount path
# passes when left to the default or set to it, and fails when set to a path every project shares.
#
# Inputs: scripts/check-devcontainer.sh scripts/lib/
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
    echo '  // A comment: the container has no socket mount — see ADR-0004.'
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

# expect <pass|fail> <name> <dir> [needle] — run the check; when a needle is given, its output
# must contain it.
expect() {
  local want="$1" name="$2" dir="$3" needle="${4:-}"
  local out rc
  out="$(bash "$CHECK" "$dir" 2>&1)"; rc=$?
  if [[ "$want" == "pass" && $rc -eq 0 && ( -z "$needle" || "$out" == *"$needle"* ) ]] \
     || [[ "$want" == "fail" && $rc -ne 0 && ( -z "$needle" || "$out" == *"$needle"* ) ]]; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "FAIL: $name (expected $want${needle:+ with needle \"$needle\"}, exit $rc)" >&2
  while IFS= read -r l; do printf '    %s\n' "$l"; done <<< "$out" >&2
}

# --- cases ---------------------------------------------------------------------------------

d="$(repo baseline)"
expect pass "a container without a socket, pinned and locked, passes" "$d" "1 Features pinned and locked"

d="$(repo socket-mount)"
config "$d" "ghcr.io/devcontainers/features/github-cli:1" \
  '"mounts": ["source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind"],'
expect fail "a host socket mount" "$d" "mounts the host Docker socket"

d="$(repo socket-run-arg)"
config "$d" "ghcr.io/devcontainers/features/github-cli:1" \
  '"runArgs": ["-v", "/var/run/docker.sock:/var/run/docker.sock"],'
expect fail "a host socket passed as a run argument" "$d" "mounts the host Docker socket"

d="$(repo docker-feature)"
config "$d" "ghcr.io/devcontainers/features/docker-outside-of-docker:1"
lock "$d" "ghcr.io/devcontainers/features/docker-outside-of-docker:1"
expect fail "a Feature that mounts the socket" "$d" "would mount the host Docker socket"

d="$(repo engine-inside)"
config "$d" "ghcr.io/devcontainers/features/docker-in-docker:2"
lock "$d" "ghcr.io/devcontainers/features/docker-in-docker:2"
expect pass "an engine inside the container talks to no host engine and is the project's choice" "$d" "1 Features pinned and locked"

d="$(repo unpinned-feature)"
config "$d" "ghcr.io/devcontainers/features/github-cli:latest"
lock "$d" "ghcr.io/devcontainers/features/github-cli:latest"
expect fail "a Feature on a mutable tag" "$d" "major version tag alone"

d="$(repo untagged-feature)"
config "$d" "ghcr.io/devcontainers/features/github-cli"
lock "$d" "ghcr.io/devcontainers/features/github-cli"
expect fail "a Feature without a tag" "$d" "major version tag alone"

d="$(repo lock-missing)"
rm "$d/.devcontainer/devcontainer-lock.json"
expect fail "no lock committed" "$d" "devcontainer-lock.json: not found"

d="$(repo lock-behind)"
config "$d" "ghcr.io/devcontainers/features/node:1"
expect fail "a Feature the lock does not resolve" "$d" "has no entry for Feature 'ghcr.io/devcontainers/features/node:1'"

d="$(repo lock-stale)"
lock "$d" "ghcr.io/devcontainers/features/github-cli:1" "ghcr.io/devcontainers/features/node:1"
expect fail "a lock entry for a Feature no longer added" "$d" "lists Feature 'ghcr.io/devcontainers/features/node:1'"

d="$(repo full-version-feature)"
config "$d" "ghcr.io/devcontainers/features/github-cli:1.2.0"
lock "$d" "ghcr.io/devcontainers/features/github-cli:1.2.0"
expect fail "a Feature on a full version instead of the major tag" "$d" "major version tag alone"

d="$(repo one-line-features)"
printf '{ "image": "x", "features": { "ghcr.io/devcontainers/features/docker-outside-of-docker:1": {}, "ghcr.io/devcontainers/features/node:1": "lts" } }\n' \
  > "$d/.devcontainer/devcontainer.json"
lock "$d" "ghcr.io/devcontainers/features/docker-outside-of-docker:1" "ghcr.io/devcontainers/features/node:1"
expect fail "a features block on one line, with a string-valued Feature, is read like any other" "$d" \
  "Feature 'ghcr.io/devcontainers/features/docker-outside-of-docker:1' would mount"

d="$(repo extension-in-container)"
settings "$d" '{ "ms-azuretools.vscode-containers": ["workspace"] }'
expect fail "the container-management extension not pinned to the host" "$d" "does not pin 'ms-azuretools.vscode-containers'"

d="$(repo extension-under-other-key)"
{
  echo '{'
  echo '  "some.other.setting": { "ms-azuretools.vscode-containers": ["ui"] },'
  echo '  "remote.extensionKind": { "ms-azuretools.vscode-docker": ["ui"] }'
  echo '}'
} > "$d/.vscode/settings.json"
expect fail "the pair under a key other than remote.extensionKind" "$d" "does not pin 'ms-azuretools.vscode-containers'"

d="$(repo no-devcontainer)"
rm -r "$d/.devcontainer"
expect fail "no Dev Container at all" "$d" "devcontainer.json: not found"

d="$(repo post-start-string)"
post_start='"git config core.hooksPath .githooks && git config merge.ff false && git config pull.ff only && git config '"$DRIVER"' && '"$SETUP_GIT"'"'
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
post_start="$POST_START"
expect pass "the git settings in a postStartCommand string pass" "$d" "git hooks enabled"

d="$(repo post-start-braces)"
# shellcheck disable=SC2016  # the variable is devcontainer.json's, not the shell's
post_start='{ "cd": "cd ${containerWorkspaceFolder}", "list": ["a]b"], "hooks": "git config core.hooksPath .githooks", "merge": "git config merge.ff false && git config pull.ff only", "index": "git config '"$DRIVER"'", "credentials": "'"$SETUP_GIT"'" }'
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
post_start="$POST_START"
expect pass "a brace or bracket in an entry before the git settings" "$d" "git hooks enabled"

for setting in "core.hooksPath .githooks" "merge.ff false" "pull.ff only" "$DRIVER"; do
  d="$(repo "post-start-without-${setting%% *}")"
  post_start="${POST_START/"git config $setting"/}"
  config "$d" "ghcr.io/devcontainers/features/github-cli:1"
  post_start="$POST_START"
  expect fail "a postStartCommand without 'git config $setting'" "$d" \
    "postStartCommand does not run 'git config $setting'"
done

d="$(repo post-start-driver-args)"
post_start="${POST_START/" %O %A %B %S %X %Y"/}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
post_start="$POST_START"
expect fail "the merge driver without the arguments git passes it" "$d" \
  "postStartCommand does not run 'git config $DRIVER'"

# shellcheck disable=SC2016  # the variables are devcontainer.json's, not the shell's
own='/workspaces/${localWorkspaceFolderBasename}'
d="$(repo mount-own)"
config "$d" "ghcr.io/devcontainers/features/github-cli:1" "\"workspaceFolder\": \"$own\"," \
  "\"workspaceMount\": \"source=\${localWorkspaceFolder},target=$own,type=bind\","
expect pass "a project mounted under a path of its own" "$d" "a path of its own"

d="$(repo mount-target-last)"
config "$d" "ghcr.io/devcontainers/features/github-cli:1" \
  "\"workspaceMount\": \"source=\${localWorkspaceFolder},type=bind,dst=$own\","
expect pass "a mount whose target comes last, under another of its names" "$d" "a path of its own"

d="$(repo mount-shared-folder)"
config "$d" "ghcr.io/devcontainers/features/github-cli:1" '"workspaceFolder": "/workspace",'
expect fail "a workspaceFolder every project shares" "$d" "workspaceFolder is not '$own'"

d="$(repo mount-shared-target)"
# shellcheck disable=SC2016  # the variable is devcontainer.json's, not the shell's
config "$d" "ghcr.io/devcontainers/features/github-cli:1" "\"workspaceFolder\": \"$own\"," \
  '"workspaceMount": "source=${localWorkspaceFolder},target=/workspace,type=bind",'
expect fail "a workspaceMount that targets a path every project shares" "$d" \
  "workspaceMount does not target '$own'"

d="$(repo post-start-missing)"
post_start=""
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
post_start="$POST_START"
expect fail "no postStartCommand at all" "$d" "postStartCommand does not run 'git config core.hooksPath .githooks'"

d="$(repo post-start-elsewhere)"
post_start='"echo started"'
config "$d" "ghcr.io/devcontainers/features/github-cli:1" \
  '"postCreateCommand": "git config core.hooksPath .githooks && git config merge.ff false && git config pull.ff only",'
post_start="$POST_START"
expect fail "the git settings in another command than postStartCommand" "$d" \
  "postStartCommand does not run 'git config core.hooksPath .githooks'"

# The GitHub login (ADR-draft-gh-login-outlives-a-rebuild).

d="$(repo gh-mount-only)"
mounts="[ \"$GH_MOUNT\" ]"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect pass "the mount of the host's .config/gh alone" "$d" "the GitHub login kept"

d="$(repo gh-mount-reordered)"
mounts="[ \"type=bind,dst=$GH_TARGET,src=$GH_SOURCE\" ]"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect pass "a mount of the host's .config/gh whose options come in another order, under other names" "$d" \
  "the GitHub login kept"

d="$(repo gh-mount-missing)"
mounts="${MOUNTS/", \"$GH_MOUNT\""/}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "no mount of the host's .config/gh" "$d" "mounts does not bind-mount '$GH_SOURCE' at '$GH_TARGET'"

d="$(repo gh-mounts-missing)"
mounts=""
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "no mounts at all" "$d" "mounts does not bind-mount '$GH_SOURCE'"

d="$(repo gh-mount-other-target)"
mounts="${MOUNTS/"target=$GH_TARGET"/target=/home/vscode/gh}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "the host's .config/gh mounted at another target" "$d" "mounts does not bind-mount '$GH_SOURCE'"

d="$(repo gh-mount-other-source)"
mounts="${MOUNTS/"source=$GH_SOURCE"/source=/tmp/gh}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "another source mounted at the target" "$d" "mounts does not bind-mount '$GH_SOURCE'"

d="$(repo gh-mount-volume)"
mounts="${MOUNTS/"$GH_MOUNT"/source=$GH_SOURCE,target=$GH_TARGET,type=volume}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "a volume instead of a bind mount" "$d" "mounts does not bind-mount '$GH_SOURCE'"

d="$(repo gh-mount-readonly)"
mounts="${MOUNTS/"$GH_MOUNT"/"$GH_MOUNT,readonly"}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "a read-only mount, in which gh auth login cannot write" "$d" \
  "mounts does not bind-mount '$GH_SOURCE'"

d="$(repo gh-mount-split)"
# shellcheck disable=SC2016  # the variables are devcontainer.json's, not the shell's
mounts="[ \"source=$GH_SOURCE,target=/home/vscode/.claude,type=bind\", \"source=\${localEnv:HOME}/.claude,target=$GH_TARGET,type=bind\" ]"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
mounts="$MOUNTS"
expect fail "the source and the target in two different mounts" "$d" \
  "mounts does not bind-mount '$GH_SOURCE'"

d="$(repo gh-init-unquoted)"
init="\"mkdir $GH_SOURCE || exit 0\""
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
init="$INIT"
expect pass "an initializeCommand that creates the source unquoted" "$d" "the GitHub login kept"

d="$(repo gh-init-missing)"
init=""
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
init="$INIT"
expect fail "no initializeCommand at all" "$d" "initializeCommand does not create '$GH_SOURCE'"

d="$(repo gh-init-no-mkdir)"
init="\"ls $GH_SOURCE || exit 0\""
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
init="$INIT"
expect fail "an initializeCommand that names the source but does not create it" "$d" \
  "initializeCommand does not create '$GH_SOURCE'"

d="$(repo gh-init-parent-only)"
# shellcheck disable=SC2016  # the variables are devcontainer.json's, not the shell's
init='"(mkdir \"${localEnv:HOME}${localEnv:USERPROFILE}/.config\" || cd .) && exit 0"'
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
init="$INIT"
expect fail "an initializeCommand that creates only the parent of the source" "$d" \
  "initializeCommand does not create '$GH_SOURCE'"

d="$(repo gh-init-longer-path)"
init="${INIT/"$GH_SOURCE"/"$GH_SOURCE-old"}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
init="$INIT"
expect fail "an initializeCommand that creates a longer path than the source" "$d" \
  "initializeCommand does not create '$GH_SOURCE'"

d="$(repo gh-init-elsewhere)"
init='"echo initialized"'
config "$d" "ghcr.io/devcontainers/features/github-cli:1" \
  "\"postCreateCommand\": \"mkdir $GH_SOURCE\","
init="$INIT"
expect fail "the source created by another command than initializeCommand" "$d" \
  "initializeCommand does not create '$GH_SOURCE'"

d="$(repo gh-setup-git-missing)"
post_start="${POST_START/", \"credentials\": \"$SETUP_GIT\""/}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
post_start="$POST_START"
expect fail "a postStartCommand without 'gh auth setup-git'" "$d" \
  "postStartCommand does not run 'gh auth setup-git'"

d="$(repo gh-setup-git-no-force)"
post_start="${POST_START/"$SETUP_GIT"/"gh auth setup-git --hostname github.com"}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1"
post_start="$POST_START"
expect fail "'gh auth setup-git' without '--force', which fails while nobody is logged in" "$d" \
  "postStartCommand does not run 'gh auth setup-git' with '--force'"

d="$(repo gh-setup-git-elsewhere)"
post_start="${POST_START/", \"credentials\": \"$SETUP_GIT\""/}"
config "$d" "ghcr.io/devcontainers/features/github-cli:1" "\"postCreateCommand\": \"$SETUP_GIT\","
post_start="$POST_START"
expect fail "'gh auth setup-git' in another command than postStartCommand" "$d" \
  "postStartCommand does not run 'gh auth setup-git'"

# --- summary -------------------------------------------------------------------------------

summary "Dev Container self-test"
