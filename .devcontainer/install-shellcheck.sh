#!/usr/bin/env bash
#
# Installs the one ShellCheck release the Dev Container and CI's shell lint both run
# (DEV-container-adds-bun-rust-shellcheck §2, §3). This file is the one place that names it: the
# version, and the SHA-256 of the release's Linux archive for each architecture it serves. The
# Dockerfile runs it into /usr/local/bin, the shell job of .github/workflows/checks.yml into a
# directory ahead of the runner's own ShellCheck on PATH. A bump changes the version and both
# digests here, and nothing else.
#
# It downloads the archive of this machine's architecture from the ShellCheck release on GitHub,
# checks it against its SHA-256 before it unpacks anything, and refuses an architecture it names
# no SHA-256 for. The release ships static binaries, so the archive needs nothing but tar and gzip.
#
# Usage:
#     .devcontainer/install-shellcheck.sh <directory>
# Exit code 0 when shellcheck is installed into the directory, 1 on a failed download or a digest
# that does not match, 2 on a wrong call or an architecture without a SHA-256.

set -euo pipefail

SHELLCHECK_VERSION="0.11.0"

if (($# != 1)); then
  echo "Usage: .devcontainer/install-shellcheck.sh <directory>" >&2
  exit 2
fi
mkdir -p "$1"
target="$(cd "$1" && pwd)"

machine="$(uname -m)"
case "$machine" in
  x86_64) arch=x86_64 sha256=b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6 ;;
  aarch64 | arm64) arch=aarch64 sha256=68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc ;;
  *)
    echo "install-shellcheck.sh: no SHA-256 for the architecture '$machine' — ShellCheck $SHELLCHECK_VERSION is installed on x86_64 and aarch64 only" >&2
    exit 2
    ;;
esac

name="shellcheck-v$SHELLCHECK_VERSION"
archive="$name.linux.$arch.tar.gz"
url="https://github.com/koalaman/shellcheck/releases/download/v$SHELLCHECK_VERSION/$archive"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 3 \
  --output "$archive" "$url"
# Nothing is unpacked before the archive matches its SHA-256.
sha256sum --check --strict <<< "$sha256  $archive"
tar -xzf "$archive" "$name/shellcheck"

install -m 0755 "$name/shellcheck" "$target/shellcheck"
"$target/shellcheck" --version
