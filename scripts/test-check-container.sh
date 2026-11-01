#!/usr/bin/env bash
#
# Self-test of scripts/check-container.sh. Verifies: ADR-0014, ADR-0015, ADR-0038
#
# Each case builds a fixture under a temporary directory — a devcontainer.json with comments that
# builds from the Dockerfile and adds the Rust Feature, and a Dockerfile that pins its base image
# and the image it copies Bun from by digest — runs the check against it, and asserts the exit code
# and, for a failing case, the message that names the violation. The baseline passes; every
# failing case breaks one thing ADR-0014 or ADR-0015 decides, and the passing cases are near
# misses the check must not mistake for one.
#
# Usage:
#     scripts/test-check-container.sh
# Exit code 0 when every case passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-container.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
passed=0

SHA="sha256:$(printf '0%.0s' {1..64})"

# The run argument and the forwarded ports a fixture names, by which the benchmark reaches a
# Chrome on the host (ADR-0038); a case clears one to break it.
RUN_ARGS='"runArgs": ["--add-host=host.docker.internal:host-gateway"],'
PORTS='"forwardPorts": [5173, 4173],'

# config <dir> <build json line> <feature ids...> — write devcontainer.json with the given build
# line and Features, beside RUN_ARGS and PORTS.
config() {
  local dir="$1" build="$2"; shift 2
  local id
  {
    echo '{'
    echo '  "name": "fixture",'
    echo '  // A comment: no "image": "x", no node Feature "ghcr.io/devcontainers/features/node:1": {}.'
    echo "  $build"
    echo "  $RUN_ARGS"
    echo "  $PORTS"
    echo '  "features": {'
    for id in "$@"; do
      echo "    \"$id\": {},"
    done
    echo '  },'
    echo '  "portsAttributes": { "5173": { "label": "example" } }'
    echo '}'
  } > "$dir/.devcontainer/devcontainer.json"
}

# dockerfile <dir> <lines...> — write the Dockerfile from the given lines.
dockerfile() {
  local dir="$1"; shift
  printf '%s\n' "# A comment: FROM debian:latest" "$@" > "$dir/.devcontainer/Dockerfile"
}

# repo <name> — a fixture that passes every check, printed as its path.
repo() {
  local dir="$work/$1"
  mkdir -p "$dir/.devcontainer"
  config "$dir" '"build": { "dockerfile": "Dockerfile" },' "ghcr.io/devcontainers/features/rust:1"
  dockerfile "$dir" \
    "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
    "COPY --from=oven/bun:1.4.3-debian@$SHA /usr/local/bin/bun /usr/local/bin/bun"
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
expect pass "a container built from a pinned Dockerfile, with Rust and no engine, passes" "$d" \
  "2 images pinned by digest, 1 Features"

# ADR-0014: the build.

d="$(repo from-image)"
config "$d" '"image": "mcr.microsoft.com/devcontainers/base:debian",' "ghcr.io/devcontainers/features/rust:1"
expect fail "a container from an image instead of the Dockerfile" "$d" "does not build from"

d="$(repo image-beside-build)"
config "$d" '"build": { "dockerfile": "Dockerfile" }, "image": "x",' "ghcr.io/devcontainers/features/rust:1"
expect fail "an image named beside the Dockerfile" "$d" "names an \"image\""

d="$(repo other-dockerfile)"
config "$d" '"build": { "dockerfile": "Containerfile" },' "ghcr.io/devcontainers/features/rust:1"
expect fail "a build from another file" "$d" "does not build from"

d="$(repo no-config)"
rm "$d/.devcontainer/devcontainer.json"
expect fail "no devcontainer.json" "$d" "devcontainer.json: not found"

# ADR-0014: the digests.

d="$(repo base-by-tag)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian" \
  "COPY --from=oven/bun:1.4.3-debian@$SHA /usr/local/bin/bun /usr/local/bin/bun"
expect fail "a base image by its tag alone" "$d" "FROM names 'mcr.microsoft.com/devcontainers/base:debian' without a digest"

d="$(repo copy-by-tag)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY --from=oven/bun:1.4.3-debian /usr/local/bin/bun /usr/local/bin/bun"
expect fail "an image copied from by its tag alone" "$d" "COPY names 'oven/bun:1.4.3-debian' without a digest"

d="$(repo short-digest)"
dockerfile "$d" "FROM mcr.microsoft.com/devcontainers/base:debian@sha256:0000"
expect fail "a digest cut short" "$d" "without a digest"

d="$(repo platform-flag)"
dockerfile "$d" "from --platform=linux/amd64 debian:bookworm AS base"
expect fail "an unpinned image behind a flag, in lower case, with a stage name" "$d" "FROM names 'debian:bookworm'"

d="$(repo stages)"
dockerfile "$d" \
  "FROM oven/bun:1.4.3-debian@$SHA AS bun" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun"
expect pass "a copy from a stage the file names pulls no image" "$d" "2 images pinned by digest"

d="$(repo stage-case)"
dockerfile "$d" \
  "FROM oven/bun:1.4.3-debian@$SHA AS Bun" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun" \
  "COPY --from=0 /usr/local/bin/bun /usr/local/bin/bunx"
expect pass "a stage named in another case, or by its index, pulls no image" "$d" "2 images pinned by digest"

d="$(repo copy-without-from)"
dockerfile "$d" "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" "COPY bin/ /usr/local/bin/"
expect pass "a copy from the build context names no image" "$d" "1 images pinned by digest"

d="$(repo no-from)"
dockerfile "$d" "RUN true"
expect fail "a Dockerfile without a FROM" "$d" "names no image in a FROM"

d="$(repo no-dockerfile)"
rm "$d/.devcontainer/Dockerfile"
expect fail "no Dockerfile" "$d" "Dockerfile: not found"

# ADR-0014: no Node.js.

d="$(repo node-feature)"
config "$d" '"build": { "dockerfile": "Dockerfile" },' \
  "ghcr.io/devcontainers/features/rust:1" "ghcr.io/devcontainers/features/node:1"
expect fail "the Node.js Feature" "$d" "Feature 'ghcr.io/devcontainers/features/node:1' installs Node.js"

d="$(repo node-untagged)"
config "$d" '"build": { "dockerfile": "Dockerfile" },' "ghcr.io/devcontainers/features/node"
expect fail "the Node.js Feature without a tag" "$d" "installs Node.js"

d="$(repo node-near-miss)"
config "$d" '"build": { "dockerfile": "Dockerfile" },' "ghcr.io/example/features/nodejs-free-tools:1"
expect pass "a Feature whose name only starts with node" "$d" "1 Features"

d="$(repo settings-glob)"
{
  echo '{'
  echo '  "build": { "dockerfile": "Dockerfile" },'
  echo "  $RUN_ARGS"
  echo "  $PORTS"
  echo '  "features": { "ghcr.io/devcontainers/features/rust:1": {} },'
  echo '  "customizations": { "vscode": { "settings": {'
  echo '    "files.watcherExclude": { "**/target/**": true, "**/docker/**": true, "**/node": true }'
  echo '  } } }'
  echo '}'
} > "$d/.devcontainer/devcontainer.json"
expect pass "a settings glob with a slash outside the features is no Feature" "$d" "1 Features"

# ADR-0015: no container engine.

d="$(repo docker-in-docker)"
config "$d" '"build": { "dockerfile": "Dockerfile" },' \
  "ghcr.io/devcontainers/features/rust:1" "ghcr.io/devcontainers/features/docker-in-docker:2"
expect fail "an engine inside the container" "$d" "docker-in-docker:2' brings a container engine"

d="$(repo podman)"
config "$d" '"build": { "dockerfile": "Dockerfile" },' "ghcr.io/example/features/podman:1"
expect fail "Podman as a Feature" "$d" "podman:1' brings a container engine"

d="$(repo compose)"
config "$d" '"build": { "dockerfile": "Dockerfile" }, "dockerComposeFile": "compose.yaml",' \
  "ghcr.io/devcontainers/features/rust:1"
expect fail "Compose services" "$d" "names a \"dockerComposeFile\""

d="$(repo one-line)"
printf '{ "build": { "dockerfile": "Dockerfile" }, "features": { "ghcr.io/devcontainers/features/rust:1": {}, "ghcr.io/devcontainers/features/docker-in-docker:2": "latest" } }\n' \
  > "$d/.devcontainer/devcontainer.json"
expect fail "a configuration on one line, with a string-valued Feature, is read like any other" "$d" \
  "docker-in-docker:2' brings a container engine"

# ADR-0038: the way to a Chrome on the host.

d="$(repo no-host)"
RUN_ARGS='"runArgs": [],' config "$d" '"build": { "dockerfile": "Dockerfile" },' \
  "ghcr.io/devcontainers/features/rust:1"
expect fail "no run argument for the host's address" "$d" "--add-host=host.docker.internal:host-gateway"

d="$(repo no-port)"
PORTS='"forwardPorts": [5173, 41730],' config "$d" '"build": { "dockerfile": "Dockerfile" },' \
  "ghcr.io/devcontainers/features/rust:1"
expect fail "the benchmark's port not forwarded, a longer number naming it no more" "$d" \
  "does not forward port 4173"

# --- summary -------------------------------------------------------------------------------

if ((failed)); then
  echo "Container self-test FAILED ($failed of $((passed + failed)) cases)." >&2
  exit 1
fi
echo "Container self-test passed ($passed cases)."
exit 0
