# The Dev Container's image (ADR-0014): the Dev Containers base image and the Bun binary, both
# pinned by digest. Rust comes as a Feature, locked by devcontainer-lock.json (ADR-0004); there is
# no Node.js (ADR-0008).
FROM mcr.microsoft.com/devcontainers/base:debian@sha256:6ee2b4097c75d33e9a94d941577a3286e5d629434fba384688b06daeeaaeac99

COPY --from=oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b /usr/local/bin/bun /usr/local/bin/bun

# bunx is bun under another name. ShellCheck comes from the base image's signed Debian archive, so
# the pre-push hook runs the shell lint CI runs.
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && apt-get update \
    && apt-get install -y --no-install-recommends shellcheck \
    && rm -rf /var/lib/apt/lists/*
