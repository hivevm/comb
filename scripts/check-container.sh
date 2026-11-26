#!/usr/bin/env bash
#
# The Dev Container's image and its reach (DEV-container-adds-bun-rust-shellcheck,
# SEC-no-container-engine), and its way to a Chrome on the host (PERF-benchmark-drives-host-chrome).
#
# scripts/check-devcontainer.sh holds the template's part, the socket, the Features' tags, and the
# lock (NUC-container-hides-host-daemon). This check holds what Comb decided on top of it, from the
# files the decisions
# name, and fails, naming each, on:
#
#   1. Build: .devcontainer/devcontainer.json not building from .devcontainer/Dockerfile — no
#      '"dockerfile": "Dockerfile"', or an '"image"' of its own
#      (DEV-container-adds-bun-rust-shellcheck).
#   2. Digests: a 'FROM' or a 'COPY --from=' of .devcontainer/Dockerfile that names an image
#      without '@sha256:' and 64 hex digits; a stage the file itself names with 'AS', in any case,
#      or a stage by its index is no image and passes (DEV-container-adds-bun-rust-shellcheck).
#   3. Node.js: a Feature whose id is a 'node' Feature ('…/node' or '…/node:N')
#   (DEV-container-adds-bun-rust-shellcheck).
#   4. Engine: a Feature whose id contains 'docker' or 'podman', or a 'dockerComposeFile'
#      (SEC-no-container-engine).
#   5. Host: no '--add-host=host.docker.internal:host-gateway' among its run arguments, or no 4173
#      among its forwarded ports, by which the benchmark reaches a Chrome on the host and that
#      Chrome its preview server (PERF-benchmark-drives-host-chrome).
#   6. ShellCheck: .devcontainer/install-shellcheck.sh, the one place that names the release, has
#      no line 'SHELLCHECK_VERSION="<major>.<minor>.<patch>"', no line naming x86_64 or aarch64
#      beside a SHA-256 of 64 hex digits, or no 'sha256sum --check' (or '-c'); or the Dockerfile
#      runs no command of a RUN that is install-shellcheck.sh, or bash or sh with it, or installs
#      a package named shellcheck with a package manager (DEV-container-adds-bun-rust-shellcheck
#      §2, §3).
#   7. Downloads: an instruction other than FROM or COPY that names a URL scheme,
#      '<scheme>://', whatever command, form, or heredoc carries it; a command of a RUN whose
#      program, after a leading '(' or '{', sudo, and env with its settings, is named curl or wget
#      by its base name; an ADD whose source starts with 'git@'; or a mark of an unsigned
#      archive or package as trusted: '[trusted=yes]', '--allow-unauthenticated',
#      'AllowUnauthenticated', 'AllowInsecureRepositories', '--allow-insecure-repositories',
#      '--allow-untrusted', or '--nogpgcheck' (DEV-container-adds-bun-rust-shellcheck §5).
#
# A Feature id is a key directly inside the 'features' object, read by tracking brace depth as
# check-devcontainer.sh reads it, so that a key elsewhere, such as a settings glob, is none.
# Full-line '//' comments are dropped first, as there; full-line '#' comments of the Dockerfile
# and the install script too. Rules 6 and 7 read the Dockerfile's instructions with their
# continuation lines joined, a line of a heredoc as one of its own, and a RUN as its commands
# split at '&&', '||', ';', and '|'. The versions inside the images, the CI smoke test asserts in
# a container built from them (.github/workflows/devcontainer.yml).
#
# Pure bash + coreutils/grep. Usage:
#     scripts/check-container.sh [--root <dir>]
# The root defaults to this repository; scripts/test-check-container.sh passes fixtures.
# Exit code 0 when the check passes, 1 otherwise.

set -uo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/bash.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/bash.sh"
# shellcheck source-path=SCRIPTDIR source=lib/root.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/root.sh"
usage="scripts/check-container.sh [--root <dir>]"
enter_root "${BASH_SOURCE[0]}" "$usage" "$@"
set -- "${ARGS[@]}"
rest_args "${BASH_SOURCE[0]}" "$usage" 0 "$@"
CONFIG=".devcontainer/devcontainer.json"
DOCKERFILE=".devcontainer/Dockerfile"
INSTALLER=".devcontainer/install-shellcheck.sh"

errors=()
add_error() { errors+=("$1"); }

# uncommented <file> <marker> — the file without its full-line comments that start with marker.
uncommented() { grep -vE "^[[:space:]]*$2" "$1"; }

# feature_ids <text> — the keys directly inside the "features" object, one per line; the reading
# of scripts/check-devcontainer.sh, which belongs to the template and is not shared.
feature_ids() {
  awk '
    {
      gsub(/\{/, "{\n"); gsub(/\}/, "\n}"); gsub(/,/, ",\n")
      n = split($0, fragments, "\n")
      for (i = 1; i <= n; i++) {
        line = fragments[i]
        if (line ~ /"features"[[:space:]]*:[[:space:]]*\{/) { base = depth; in_features = 1 }
        else if (in_features && depth == base + 1 && line ~ /^[[:space:]]*"[^"]+"[[:space:]]*:/) {
          key = line
          sub(/^[[:space:]]*"/, "", key); sub(/".*$/, "", key)
          print key
        }
        m = split(line, chars, "")
        for (j = 1; j <= m; j++) {
          if (chars[j] == "{") depth++
          else if (chars[j] == "}") { depth--; if (in_features && depth == base) in_features = 0 }
        }
      }
    }' <<< "$1"
}

# logical <text> — the Dockerfile's instructions one per line, a line that ends in '\' joined to
# the next.
logical() {
  awk '{ if (sub(/\\[[:space:]]*$/, " ")) { held = held $0 } else { print held $0; held = "" } }
       END { if (held != "") print held }' <<< "$1"
}

DIGEST='@sha256:[0-9a-f]{64}$'
SHA256='(^|[^0-9a-f])[0-9a-f]{64}([^0-9a-f]|$)'

features=()
if [[ ! -f "$ROOT/$CONFIG" ]]; then
  add_error "$CONFIG: not found — DEV-container-adds-bun-rust-shellcheck builds the Dev Container from it"
else
  config="$(uncommented "$ROOT/$CONFIG" '//')"

  # 1. Build.
  grep -qE '"dockerfile"[[:space:]]*:[[:space:]]*"Dockerfile"' <<< "$config" \
    || add_error "$CONFIG: does not build from \"dockerfile\": \"Dockerfile\" — the Dev Container builds from $DOCKERFILE (DEV-container-adds-bun-rust-shellcheck)"
  grep -qE '"image"[[:space:]]*:' <<< "$config" \
    && add_error "$CONFIG: names an \"image\" — the Dev Container builds from $DOCKERFILE, not from an image (DEV-container-adds-bun-rust-shellcheck)"

  # 4. Engine: Compose.
  grep -qE '"dockerComposeFile"[[:space:]]*:' <<< "$config" \
    && add_error "$CONFIG: names a \"dockerComposeFile\" — the work reaches no container engine and starts no service (SEC-no-container-engine)"

  # 5. Host.
  grep -qF '"--add-host=host.docker.internal:host-gateway"' <<< "$config" \
    || add_error "$CONFIG: has no run argument --add-host=host.docker.internal:host-gateway — the benchmark reaches a Chrome on the host by it (PERF-benchmark-drives-host-chrome)"
  grep -qE '"forwardPorts"[[:space:]]*:[[:space:]]*\[[^]]*\b4173\b' <<< "$config" \
    || add_error "$CONFIG: does not forward port 4173 — a Chrome on the host loads the benchmark's preview server through it (PERF-benchmark-drives-host-chrome)"

  mapfile -t features < <(feature_ids "$config")
  for id in "${features[@]}"; do
    # 3. Node.js.
    [[ "$id" =~ /node(:[^/]*)?$ ]] \
      && add_error "$CONFIG: Feature '$id' installs Node.js — the container carries Bun and no Node.js (DEV-container-adds-bun-rust-shellcheck)"
    # 4. Engine: a Feature.
    [[ "$id" == *docker* || "$id" == *podman* ]] \
      && add_error "$CONFIG: Feature '$id' brings a container engine — the work inside the Dev Container reaches none (SEC-no-container-engine)"
  done
fi

# 2. Digests.
images=0
if [[ ! -f "$ROOT/$DOCKERFILE" ]]; then
  add_error "$DOCKERFILE: not found — DEV-container-adds-bun-rust-shellcheck builds the Dev Container from it"
else
  stages=()
  while read -r instruction rest; do
    case "${instruction^^}" in
      FROM)
        read -r -a words <<< "$rest"
        image=""
        for ((i = 0; i < ${#words[@]}; i++)); do
          [[ "${words[i]}" == --* ]] && continue
          [[ -z "$image" ]] && { image="${words[i]}"; continue; }
          [[ "${words[i]^^}" == AS && -n "${words[i + 1]+set}" ]] && stages+=("${words[i + 1],,}")
        done
        ;;
      COPY)
        image="$(grep -oE -- '--from=[^[:space:]]+' <<< "$rest" | sed 's/^--from=//')"
        [[ -z "$image" ]] && continue
        ;;
      *) continue ;;
    esac
    # A FROM that names an earlier stage, or a COPY from one by its name or its index, pulls no
    # image.
    stage=0
    [[ "$image" =~ ^[0-9]+$ ]] && stage=1
    for s in "${stages[@]}"; do [[ "$s" == "${image,,}" ]] && stage=1; done
    if ((stage)); then continue; fi
    images=$((images + 1))
    [[ "$image" =~ $DIGEST ]] \
      || add_error "$DOCKERFILE: ${instruction^^} names '$image' without a digest — every image is pinned by '@sha256:' (DEV-container-adds-bun-rust-shellcheck)"
  done < <(uncommented "$ROOT/$DOCKERFILE" '#')
  ((images)) || add_error "$DOCKERFILE: names no image in a FROM — there is nothing the Dev Container builds from"

  # 6. ShellCheck, and 7. Downloads, by instruction and by command.
  runs_installer=0
  while read -r instruction rest; do
    case "${instruction^^}" in
      FROM | COPY) ;;
      *)
        [[ "$instruction $rest" =~ [a-zA-Z][a-zA-Z0-9+.-]*://[^][:space:]\"\'(),]* ]] \
          && add_error "$DOCKERFILE: ${instruction^^} names a URL, '${BASH_REMATCH[0]}' — the Dockerfile fetches nothing from the network by its own command; a download goes through a script that checks its SHA-256 (DEV-container-adds-bun-rust-shellcheck §5)"
        ;;
    esac
    case "${instruction^^}" in
      ADD)
        read -r -a words <<< "$rest"
        for word in "${words[@]}"; do
          [[ "$word" == --* ]] && continue
          [[ "$word" == git@* ]] \
            && add_error "$DOCKERFILE: ADD fetches '$word' — the Dockerfile fetches nothing from the network by its own command (DEV-container-adds-bun-rust-shellcheck §5)"
          break
        done
        ;;
      RUN)
        mapfile -t commands < <(sed -E 's/(&&|\|\||;|\|)/\n/g' <<< "$rest")
        for command in "${commands[@]}"; do
          read -r -a words <<< "$command"
          ((${#words[@]})) || continue
          # A leading '(' or '{', sudo, and env with its settings run the program after them; a
          # command they leave without words runs nothing.
          words[0]="${words[0]#[({]}"
          [[ -z "${words[0]}" ]] && words=("${words[@]:1}")
          [[ "${words[0]:-}" == sudo ]] && words=("${words[@]:1}")
          if [[ "${words[0]:-}" == env ]]; then
            words=("${words[@]:1}")
            while [[ "${words[0]:-}" == *=* || "${words[0]:-}" == -* ]]; do
              words=("${words[@]:1}")
            done
          fi
          ((${#words[@]})) || continue
          case "${words[0]##*/}" in
            curl | wget)
              add_error "$DOCKERFILE: RUN runs ${words[0]##*/} — the Dockerfile fetches nothing from the network by its own command; a download goes through a script that checks its SHA-256 (DEV-container-adds-bun-rust-shellcheck §5)" ;;
          esac
          script="${words[0]}"
          [[ "$script" == bash || "$script" == sh ]] && script="${words[1]:-}"
          [[ "$script" == install-shellcheck.sh || "$script" == */install-shellcheck.sh ]] \
            && runs_installer=1
          case "${words[0]}" in
            apt-get | apt | aptitude | apk | dnf | yum | microdnf | zypper | pacman)
              for word in "${words[@]:1}"; do
                [[ "$word" == shellcheck || "$word" == shellcheck=* ]] \
                  && add_error "$DOCKERFILE: installs ShellCheck from a package with ${words[0]} — it comes from $INSTALLER, the one release CI runs too (DEV-container-adds-bun-rust-shellcheck §3)"
              done ;;
          esac
        done
        ;;
    esac
  done < <(logical "$(uncommented "$ROOT/$DOCKERFILE" '#')")
  ((runs_installer)) \
    || add_error "$DOCKERFILE: does not run install-shellcheck.sh as a command of a RUN — the container's ShellCheck is the release $INSTALLER names (DEV-container-adds-bun-rust-shellcheck §3)"
  while read -r mark; do
    add_error "$DOCKERFILE: marks an archive or a package as trusted without a signature, '$mark' — the Dockerfile installs only what its archive signs (DEV-container-adds-bun-rust-shellcheck §5)"
  done < <(uncommented "$ROOT/$DOCKERFILE" '#' \
    | grep -oiE '\[?trusted=yes\]?|--allow-unauthenticated|AllowUnauthenticated|AllowInsecureRepositories|--allow-insecure-repositories|--allow-untrusted|--nogpgcheck' \
    | sort -u)
fi

# 6. ShellCheck: the install script.
shellcheck_version=""
if [[ ! -f "$ROOT/$INSTALLER" ]]; then
  add_error "$INSTALLER: not found — it is the one place that names the ShellCheck release, for the container and CI (DEV-container-adds-bun-rust-shellcheck §2)"
else
  installer="$(uncommented "$ROOT/$INSTALLER" '#')"
  shellcheck_version="$(grep -m1 -oE '^SHELLCHECK_VERSION="[0-9]+\.[0-9]+\.[0-9]+"[[:space:]]*$' <<< "$installer")"
  shellcheck_version="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<< "$shellcheck_version")"
  [[ -n "$shellcheck_version" ]] \
    || add_error "$INSTALLER: names no SHELLCHECK_VERSION=\"<major>.<minor>.<patch>\" — the script names the one ShellCheck release (DEV-container-adds-bun-rust-shellcheck §2)"
  for arch in x86_64 aarch64; do
    grep -qE "$SHA256" <<< "$(grep -E "$arch" <<< "$installer")" \
      || add_error "$INSTALLER: names no SHA-256 for $arch beside it — the archive of each architecture is checked against its own (DEV-container-adds-bun-rust-shellcheck §2)"
  done
  grep -qE 'sha256sum[[:space:]]+(.*[[:space:]])?(--check|-c)([[:space:]]|$)' <<< "$installer" \
    || add_error "$INSTALLER: runs no 'sha256sum --check' — the archive is checked against its SHA-256 before anything is unpacked (DEV-container-adds-bun-rust-shellcheck §2)"
fi

if ((${#errors[@]})); then
  echo "Container check FAILED:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  exit 1
fi

echo "Container check passed ($images images pinned by digest, ShellCheck $shellcheck_version pinned by SHA-256, ${#features[@]} Features, no Node.js, no container engine)."
exit 0
