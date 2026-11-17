# The Dev Container's image (DEV-container-adds-bun-and-rust): the Dev Containers base image and the
# Bun binary, both
# pinned by digest. Rust comes as a Feature, locked by devcontainer-lock.json
# (NUC-container-hides-host-daemon §3); there is
# no Node.js (DEV-bun-vite-wasm-pack).
FROM mcr.microsoft.com/devcontainers/base:debian@sha256:38f9e6c291f054e3c868d95a5477cbfcf76c0fa7c218dda65dc6aa3fbfe06871

COPY --from=oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b /usr/local/bin/bun /usr/local/bin/bun

# bunx is bun under another name. ShellCheck comes from the base image's signed Debian archive, so
# the pre-push hook runs the shell lint CI runs.
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && apt-get update \
    && apt-get install -y --no-install-recommends shellcheck \
    && rm -rf /var/lib/apt/lists/*
