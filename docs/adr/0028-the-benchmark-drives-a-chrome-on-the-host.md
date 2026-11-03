# ADR-0028: The benchmark can drive a Chrome on the host, through its debugging port bridged to the Dev Container

- **Status:** 🟢 accepted
- **Date:** 2026-11-02
- **Deciders:** Markus Brigl
- **Applies to:** `bench/run.ts` and its tests under `bench/`, `.devcontainer/devcontainer.json`, and the **Benchmark** part of `README.md`

## Context

Q-1 and Q-2 are measured on the reference machine, a laptop with an integrated GPU of the class of
Intel Iris Xe or AMD Radeon 680M, in current stable Chrome, by `BENCH_HEADED=1 bun run bench`
([ADR-0008](0008-toolchain.md), ticket 16 of revision-2026-10-18). That command launches
Playwright's Chromium in the place it runs. The Dev Container has no display and no GPU: it sees no
`/dev/dri`, and Chromium in it renders on SwiftShader, whose frame times are raster-bound and say
nothing about a GPU. So the measurement has to run outside the container, with Bun, Rust, and the
WebAssembly target set up on the host a second time, though the maintainer works from the container.

A Chrome on the host draws with the host's GPU and its drivers, which is what Q-1 and Q-2 ask.
Playwright attaches to a running Chromium-based browser through the DevTools protocol
(`connectOverCDP`). Chrome serves that protocol on a debugging port bound to `127.0.0.1` of the
host, which the container does not reach, and since Chrome 136 only for a profile other than the
default one. On Linux, Docker gives a container the host's address on its bridge as
`host.docker.internal` where it is started with `--add-host=host.docker.internal:host-gateway`, and
VS Code forwards a port the container serves to `localhost` of the host.

## Decision

We will let `bun run bench`, given `BENCH_CDP` with the address of a Chrome's debugging port,
attach to that Chrome instead of launching Chromium, so that the maintainer measures from the Dev
Container in a Chrome on the host, reached through a forwarder on the host's Docker bridge.

- **On the host, for a measurement only:** Chrome started with `--remote-debugging-port=9222` and a
  `--user-data-dir` of a fresh, empty directory, never the maintainer's own profile; and
  `socat TCP-LISTEN:9223,bind=<the Docker bridge's address>,fork TCP:127.0.0.1:9222`, which listens
  on the bridge alone, not on the network. Both end with the measurement.
- **The container:** `devcontainer.json` adds `--add-host=host.docker.internal:host-gateway` to its
  run arguments and forwards the benchmark's port, 4173; nothing else of the container changes, and
  it reaches no container engine ([ADR-0004](0004-dev-container-runtime.md),
  [ADR-0015](0015-no-container-access.md)).
- **The benchmark:** with `BENCH_CDP=http://host.docker.internal:9223` it attaches to that browser,
  opens its pages in a context of its own at the size it launches with, and loads the example from
  `http://localhost:4173`, the port VS Code forwards to the host; it records that it measured an
  attached browser, with the browser's version and the GPU its WebGL reports, beside the CPU model,
  and closes only what it opened. Without `BENCH_CDP` it launches Chromium.
- **The README** says the steps on the host, the commands above among them.

**Out of scope:** throttling the measured page's CPU, so that a machine faster than the reference
stands in for it, which [ADR-0029](0029-the-benchmark-can-slow-the-measured-pages-cpu.md) decides;
which machine is the reference, which is the specification's.

## Alternatives considered

- **The GPU into the container** — `--device=/dev/dri`, the render groups, a Mesa driver in the
  image, and the host's X11 or Wayland socket for a window: Chromium runs where the benchmark does,
  but the socket hands the container the host's desktop, its input and its screen, and the image
  grows by a graphics stack.
- **`--network=host`** — the container reaches the debugging port and Chrome the preview server
  directly, with no forwarder, but the container then sees every port of the host the whole time,
  not only during a measurement.
- **A script in the repository that the host runs** — one command starts Chrome and the forwarder
  and stops both, but code of the repository then runs on the host, outside the container's
  boundary, which nothing else of the work does.
- **The measurement outside the container** — no change, but the toolchain set up a second time on
  the host and kept in step with the container's by hand.

## Sources / Prior art

- Playwright, `browserType.connectOverCDP`: Chromium-based browsers only, and "significantly lower
  fidelity than the Playwright protocol connection" —
  <https://playwright.dev/docs/api/class-browsertype>.
- Chrome 136 refuses remote debugging on the default profile directory —
  <https://groups.google.com/a/chromium.org/g/chromium-dev/c/Hk-7w9j0j3I>,
  <https://github.com/trycua/cua/issues/2916> (both checked 2026-11-02).
- Docker, `--add-host=host.docker.internal:host-gateway` on Linux, Docker 20.10 and later.
- The maintainer's machine as the container sees it, 2026-11-02: a Dell Precision 3460, Intel Core
  i7-13700, Intel UHD Graphics 770 (PCI 8086:a780), no `/dev/dri` in the container.

## Consequences

- Positive: Q-1 and Q-2 are measured from the container in current stable Chrome on the host's
  GPU, as the specification names the browser, with no second toolchain on the host.
- Positive: the container gains one host name and one forwarded port; the bridge and the debugging
  port exist only while a measurement runs.
- Negative / trade-offs: while it runs, any process on the host or in a container on the bridge
  that reaches the port controls that Chrome; the throwaway profile holds nothing worth taking.
- Negative / trade-offs: an attached browser is driven with less fidelity than one Playwright
  launches, and with other arguments than the benchmark's launch passes; the record says which
  measured, so a run of one kind is compared with the baselines of that kind only.
- Negative / trade-offs: the steps on the host, Chrome's flags and socat, are the maintainer's to
  run by hand.
- Follow-ups: whether a run of an attached browser earns baselines of its own under
  `bench/baselines/`.

## Enforcement

A test under `bench/`, citing `Verifies: ADR-0028`, asserts that the benchmark launches Chromium
without `BENCH_CDP`, attaches to the address `BENCH_CDP` gives, refuses one that is not an `http`
address of a host and port, and marks its record as of an attached browser.
`scripts/check-container.sh` fails where `devcontainer.json` names no
`--add-host=host.docker.internal:host-gateway` or does not forward port 4173, citing this ADR.
**Not mechanically decidable:** that the attached Chrome runs on the host with a throwaway profile
and that the forwarder listens on the bridge alone; the README's steps say so, and the record names
the browser and the GPU it measured.
