# The Dev Container's image (DEV-container-adds-bun-rust-shellcheck): the Dev Containers base image
# and the Bun binary, both pinned by digest, and the one ShellCheck release CI's shell lint runs
# too. Rust comes as a Feature, locked by devcontainer-lock.json
# (NUC-container-hides-host-daemon §3); there is no Node.js (DEV-bun-vite-wasm-pack).
FROM mcr.microsoft.com/devcontainers/base:debian@sha256:41ff7ce12ec45f2704f27a6e091831186ad922ec8112e6339425bfefdf5a70f9

COPY --from=oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b /usr/local/bin/bun /usr/local/bin/bun

# bunx is bun under another name. ShellCheck comes from install-shellcheck.sh beside this file,
# which names the release and checks its download against a SHA-256; the shell job of
# .github/workflows/checks.yml runs the same script, so the pre-push hook lints as CI does.
COPY install-shellcheck.sh /tmp/install-shellcheck.sh
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && bash /tmp/install-shellcheck.sh /usr/local/bin \
    && rm /tmp/install-shellcheck.sh
