#!/usr/bin/env bash
#
# The Dev Container's image and its reach (ADR-0014, ADR-0015), and its way to a Chrome on the host
# (ADR-0028).
#
# scripts/check-devcontainer.sh holds the template's part, the socket, the Features' tags, and the
# lock (ADR-0004). This check holds what Comb decided on top of it, from the files the decisions
# name, and fails, naming each, on:
#
#   1. Build: .devcontainer/devcontainer.json not building from .devcontainer/Dockerfile — no
#      '"dockerfile": "Dockerfile"', or an '"image"' of its own (ADR-0014).
#   2. Digests: a 'FROM' or a 'COPY --from=' of .devcontainer/Dockerfile that names an image
#      without '@sha256:' and 64 hex digits; a stage the file itself names with 'AS', in any case,
#      or a stage by its index is no image and passes (ADR-0014).
#   3. Node.js: a Feature whose id is a 'node' Feature ('…/node' or '…/node:N') (ADR-0014).
#   4. Engine: a Feature whose id contains 'docker' or 'podman', or a 'dockerComposeFile'
#      (ADR-0015).
#   5. Host: no '--add-host=host.docker.internal:host-gateway' among its run arguments, or no 4173
#      among its forwarded ports, by which the benchmark reaches a Chrome on the host and that
#      Chrome its preview server (ADR-0028).
#
# A Feature id is a key directly inside the 'features' object, read by tracking brace depth as
# check-devcontainer.sh reads it, so that a key elsewhere, such as a settings glob, is none.
# Full-line '//' comments are dropped first, as there; full-line '#' comments of the Dockerfile
# too. The versions inside the images, the CI smoke test asserts in a container built from them
# (.github/workflows/devcontainer.yml).
#
# Pure bash + coreutils/grep. Usage:
#     scripts/check-container.sh [repository root]
# The root defaults to this repository; scripts/test-check-container.sh passes fixtures.
# Exit code 0 when the check passes, 1 otherwise.

set -uo pipefail

ROOT="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd)"
CONFIG=".devcontainer/devcontainer.json"
DOCKERFILE=".devcontainer/Dockerfile"

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

DIGEST='@sha256:[0-9a-f]{64}$'

features=()
if [[ ! -f "$ROOT/$CONFIG" ]]; then
  add_error "$CONFIG: not found — ADR-0014 builds the Dev Container from it"
else
  config="$(uncommented "$ROOT/$CONFIG" '//')"

  # 1. Build.
  grep -qE '"dockerfile"[[:space:]]*:[[:space:]]*"Dockerfile"' <<< "$config" \
    || add_error "$CONFIG: does not build from \"dockerfile\": \"Dockerfile\" — the Dev Container builds from $DOCKERFILE (ADR-0014)"
  grep -qE '"image"[[:space:]]*:' <<< "$config" \
    && add_error "$CONFIG: names an \"image\" — the Dev Container builds from $DOCKERFILE, not from an image (ADR-0014)"

  # 4. Engine: Compose.
  grep -qE '"dockerComposeFile"[[:space:]]*:' <<< "$config" \
    && add_error "$CONFIG: names a \"dockerComposeFile\" — the work reaches no container engine and starts no service (ADR-0015)"

  # 5. Host.
  grep -qF '"--add-host=host.docker.internal:host-gateway"' <<< "$config" \
    || add_error "$CONFIG: has no run argument --add-host=host.docker.internal:host-gateway — the benchmark reaches a Chrome on the host by it (ADR-0028)"
  grep -qE '"forwardPorts"[[:space:]]*:[[:space:]]*\[[^]]*\b4173\b' <<< "$config" \
    || add_error "$CONFIG: does not forward port 4173 — a Chrome on the host loads the benchmark's preview server through it (ADR-0028)"

  mapfile -t features < <(feature_ids "$config")
  for id in "${features[@]}"; do
    # 3. Node.js.
    [[ "$id" =~ /node(:[^/]*)?$ ]] \
      && add_error "$CONFIG: Feature '$id' installs Node.js — the container carries Bun and no Node.js (ADR-0014)"
    # 4. Engine: a Feature.
    [[ "$id" == *docker* || "$id" == *podman* ]] \
      && add_error "$CONFIG: Feature '$id' brings a container engine — the work inside the Dev Container reaches none (ADR-0015)"
  done
fi

# 2. Digests.
images=0
if [[ ! -f "$ROOT/$DOCKERFILE" ]]; then
  add_error "$DOCKERFILE: not found — ADR-0014 builds the Dev Container from it"
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
          [[ "${words[i]^^}" == AS ]] && stages+=("${words[i + 1],,}")
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
      || add_error "$DOCKERFILE: ${instruction^^} names '$image' without a digest — every image is pinned by '@sha256:' (ADR-0014)"
  done < <(uncommented "$ROOT/$DOCKERFILE" '#')
  ((images)) || add_error "$DOCKERFILE: names no image in a FROM — there is nothing the Dev Container builds from"
fi

if ((${#errors[@]})); then
  echo "Container check FAILED:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  exit 1
fi

echo "Container check passed ($images images pinned by digest, ${#features[@]} Features, no Node.js, no container engine)."
exit 0
