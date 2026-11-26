#!/usr/bin/env bash
#
# Self-test of scripts/check-container.sh.
# Verifies: DEV-container-adds-bun-and-rust, SEC-no-container-engine
# Verifies: DEV-container-adds-bun-rust-shellcheck
# Verifies: PERF-benchmark-drives-host-chrome
#
# Each case builds a fixture under a temporary directory — a devcontainer.json with comments that
# builds from the Dockerfile and adds the Rust Feature, and a Dockerfile that pins its base image
# and the image it copies Bun from by digest and runs the ShellCheck install script, beside an
# install script that names the release and its SHA-256s — runs the check against it, and asserts
# the exit code and, for a failing case, the message that names the violation. The baseline passes;
# every failing case breaks one thing DEV-container-adds-bun-and-rust,
# DEV-container-adds-bun-rust-shellcheck, or SEC-no-container-engine decides, and the passing cases
# are near misses the check must not mistake for one.
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
# Chrome on the host (PERF-benchmark-drives-host-chrome); a case clears one to break it.
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

# The lines of a Dockerfile that copy the ShellCheck install script in and run it.
INSTALL=(
  "COPY install-shellcheck.sh /tmp/install-shellcheck.sh"
  "RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \\"
  "    && /tmp/install-shellcheck.sh /usr/local/bin \\"
  "    && rm /tmp/install-shellcheck.sh"
)

# installer <dir> <lines...> — write the ShellCheck install script from the given lines.
installer() {
  local dir="$1"; shift
  printf '%s\n' '#!/usr/bin/env bash' "# A comment: SHELLCHECK_VERSION=\"9.9.9\"" "$@" \
    > "$dir/.devcontainer/install-shellcheck.sh"
}

X86="b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6"
ARM="68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc"
VERSION_LINE='SHELLCHECK_VERSION="0.11.0"'
X86_LINE="  x86_64) arch=x86_64 sha256=$X86 ;;"
ARM_LINE="  aarch64 | arm64) arch=aarch64 sha256=$ARM ;;"
# shellcheck disable=SC2016  # the fixture's expansions are its own
CHECK_LINE='sha256sum --check --strict <<< "$sha256  $archive"'

# repo <name> — a fixture that passes every check, printed as its path.
repo() {
  local dir="$work/$1"
  mkdir -p "$dir/.devcontainer"
  config "$dir" '"build": { "dockerfile": "Dockerfile" },' "ghcr.io/devcontainers/features/rust:1"
  dockerfile "$dir" \
    "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
    "COPY --from=oven/bun:1.4.3-debian@$SHA /usr/local/bin/bun /usr/local/bin/bun" \
    "${INSTALL[@]}"
  installer "$dir" "$VERSION_LINE" "$X86_LINE" "$ARM_LINE" "$CHECK_LINE"
  echo "$dir"
}

# expect <pass|fail> <name> <dir> [needle] — run the check; when a needle is given, its output
# must contain it.
expect() {
  local want="$1" name="$2" dir="$3" needle="${4:-}"
  local out rc
  out="$(bash "$CHECK" --root "$dir" 2>&1)"; rc=$?
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
  "2 images pinned by digest, ShellCheck 0.11.0 pinned by SHA-256, 1 Features"

# DEV-container-adds-bun-and-rust: the build.

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

# DEV-container-adds-bun-and-rust: the digests.

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
  "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun" \
  "${INSTALL[@]}"
expect pass "a copy from a stage the file names pulls no image" "$d" "2 images pinned by digest"

d="$(repo stage-case)"
dockerfile "$d" \
  "FROM oven/bun:1.4.3-debian@$SHA AS Bun" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun" \
  "COPY --from=0 /usr/local/bin/bun /usr/local/bin/bunx" \
  "${INSTALL[@]}"
expect pass "a stage named in another case, or by its index, pulls no image" "$d" "2 images pinned by digest"

d="$(repo stage-unnamed)"
dockerfile "$d" "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA AS" "${INSTALL[@]}"
expect pass "an AS without a name after it names no stage, and does not stop the check" "$d" \
  "1 images pinned by digest"

d="$(repo copy-without-from)"
dockerfile "$d" "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" "COPY bin/ /usr/local/bin/" "${INSTALL[@]}"
expect pass "a copy from the build context names no image" "$d" "1 images pinned by digest"

d="$(repo no-from)"
dockerfile "$d" "RUN true"
expect fail "a Dockerfile without a FROM" "$d" "names no image in a FROM"

d="$(repo no-dockerfile)"
rm "$d/.devcontainer/Dockerfile"
expect fail "no Dockerfile" "$d" "Dockerfile: not found"

# DEV-container-adds-bun-rust-shellcheck: the install script names the release.

d="$(repo no-installer)"
rm "$d/.devcontainer/install-shellcheck.sh"
expect fail "no install script" "$d" "install-shellcheck.sh: not found"

d="$(repo no-version)"
installer "$d" 'SHELLCHECK_VERSION="latest"' "$X86_LINE" "$ARM_LINE" "$CHECK_LINE"
expect fail "an install script that names no version, a commented one naming none either" "$d" \
  "names no SHELLCHECK_VERSION"

d="$(repo no-x86)"
installer "$d" "$VERSION_LINE" "  x86_64) arch=x86_64 ;;" "$ARM_LINE" "$CHECK_LINE"
expect fail "an install script without the SHA-256 for x86_64" "$d" "no SHA-256 for x86_64"

d="$(repo no-arm)"
installer "$d" "$VERSION_LINE" "$X86_LINE" "# $ARM_LINE" "$CHECK_LINE"
expect fail "an install script whose aarch64 SHA-256 is commented out" "$d" "no SHA-256 for aarch64"

d="$(repo no-sha-check)"
installer "$d" "$VERSION_LINE" "$X86_LINE" "$ARM_LINE" "sha256sum \"\$archive\""
expect fail "an install script that hashes without checking" "$d" "runs no 'sha256sum --check'"

# DEV-container-adds-bun-rust-shellcheck: the Dockerfile runs it, and fetches nothing itself.

d="$(repo installer-not-run)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY install-shellcheck.sh /tmp/install-shellcheck.sh"
expect fail "a Dockerfile that copies the install script in but runs it not" "$d" \
  "does not run install-shellcheck.sh"

d="$(repo installer-removed)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY install-shellcheck.sh /tmp/install-shellcheck.sh" \
  "RUN rm /tmp/install-shellcheck.sh"
expect fail "a RUN that names the install script but runs another command" "$d" \
  "does not run install-shellcheck.sh"

d="$(repo installer-by-sh)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "COPY install-shellcheck.sh /tmp/install-shellcheck.sh" \
  "RUN chmod +x /tmp/install-shellcheck.sh; sudo sh /tmp/install-shellcheck.sh /usr/local/bin"
expect pass "the install script run by sh, after another command" "$d" "ShellCheck 0.11.0"

d="$(repo apt-shellcheck)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN apt-get update \\" \
  "    && apt-get install -y --no-install-recommends shellcheck \\" \
  "    && rm -rf /var/lib/apt/lists/*"
expect fail "ShellCheck from the Debian archive besides the script" "$d" "installs ShellCheck from a package"

d="$(repo apt-other)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN apt-get update && apt-get install -y --no-install-recommends jq && echo shellcheck-free"
expect pass "a package that is not ShellCheck, beside the word on another command" "$d" \
  "ShellCheck 0.11.0 pinned by SHA-256"

d="$(repo curl)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN apt-get install -y curl \\" \
  "    && curl -fsSL https://example.com/tool -o /usr/local/bin/tool"
expect fail "a download by curl in the Dockerfile" "$d" "RUN names a URL, 'https://example.com/tool'"

d="$(repo wget)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "run cd /tmp; wget -q https://example.com/tool"
expect fail "a download by wget in the Dockerfile, in lower case" "$d" "RUN names a URL"

# download <name> <lines...> — a fixture whose Dockerfile downloads by the given lines, which
# must fail.
download() {
  local dir
  dir="$(repo "$1")"
  dockerfile "$dir" \
    "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
    "${INSTALL[@]}" \
    "${@:2}"
  expect fail "a download however spelled: $1" "$dir" "names a URL, 'https://example.com/tool'"
}
download exec-form 'RUN ["curl", "-o", "/tmp/tool", "https://example.com/tool"]'
download env-curl "RUN env curl -o /tmp/tool https://example.com/tool"
download absolute-curl "RUN /usr/bin/curl -o /tmp/tool https://example.com/tool"
download subshell "RUN (curl -o /tmp/tool https://example.com/tool)"
download bash-c "RUN bash -c \"curl -o /tmp/tool https://example.com/tool\""
download heredoc "RUN <<EOT" "set -e" "python3 -c 'import urllib.request as u; u.urlretrieve(\"https://example.com/tool\")'" "EOT"
download continued "RUN true \\" "    && git clone https://example.com/tool /opt/tool"

d="$(repo curl-without-scheme)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN cd /tmp && sudo env HOME=/tmp /usr/bin/curl -fsSL -o /tmp/x example.com/tool"
expect fail "curl by its path, through sudo and env, of an address without a scheme" "$d" "RUN runs curl"

d="$(repo wget-in-group)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN { wget -q example.com/tool; }"
expect fail "wget in a group, of an address without a scheme" "$d" "RUN runs wget"

d="$(repo add-git)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "ADD --keep-git-dir=true git@github.com:o/r.git /opt/r"
expect fail "an ADD of a repository by its SSH address" "$d" "ADD fetches 'git@github.com:o/r.git'"

d="$(repo nothing-left)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN env FOO=1" \
  "RUN sudo" \
  "RUN true && ( true )" \
  "RUN true && ("
expect pass "a command that sudo, env, or a group leave without words runs nothing" "$d" \
  "ShellCheck 0.11.0 pinned by SHA-256"

d="$(repo url-in-comment)"
dockerfile "$d" \
  "# See https://example.com/tool for the release." \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}"
expect pass "a URL in a comment fetches nothing" "$d" "ShellCheck 0.11.0"

d="$(repo curl-package)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN apt-get install -y curl libcurl4 wget"
expect pass "curl and wget installed as packages run nothing" "$d" "ShellCheck 0.11.0"

d="$(repo add-url)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "ADD --checksum=sha256:$X86 https://example.com/tool.tar.gz /tmp/"
expect fail "an ADD of a URL, even with a checksum" "$d" "ADD names a URL"

d="$(repo add-local)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "ADD files.tar.gz /opt/"
expect pass "an ADD from the build context fetches nothing" "$d" "ShellCheck 0.11.0"

d="$(repo trusted)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN echo 'deb [trusted=yes] http://example.com/debian stable main' > /etc/apt/sources.list.d/x.list"
expect fail "an archive marked as trusted" "$d" "trusted=yes"

d="$(repo unauthenticated)"
dockerfile "$d" \
  "FROM mcr.microsoft.com/devcontainers/base:debian@$SHA" \
  "${INSTALL[@]}" \
  "RUN apt-get install -y --allow-unauthenticated tool"
expect fail "an unauthenticated package allowed" "$d" "--allow-unauthenticated"

# DEV-container-adds-bun-and-rust: no Node.js.

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

# SEC-no-container-engine: no container engine.

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

# PERF-benchmark-drives-host-chrome: the way to a Chrome on the host.

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
