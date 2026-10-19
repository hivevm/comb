# ADR-0019: The host application hands Comb the engine's WebAssembly; Comb requests nothing itself

- **Status:** 🟡 proposed
- **Date:** 2026-10-19
- **Deciders:** Markus Brigl
- **Applies to:** `createComb` and `CombOptions` in `packages/comb/src/api/`, the loading of the engine in `packages/comb/src/bridge/`, the exports of `packages/comb/package.json`, the library build, and `scripts/check-bundle.sh`

## Context

Q-6 says the system never makes a network request of its own and works under a Content Security
Policy that allows `wasm-unsafe-eval` but not `unsafe-eval`. Today `createComb` calls the
initialiser wasm-bindgen generates without an argument. That initialiser then resolves
`engine_bg.wasm` next to its module (`new URL(…, import.meta.url)`) and calls `fetch` on it. In
the library build Vite inlines the file as a `data:` URL, so even the published bundle calls
`fetch`. That is a request Comb makes itself, and it is governed by the page's `connect-src`,
which a host application's policy may not open for it.

The initialiser already takes what to instantiate from: a URL, a `Request`, a `Response` or a
promise of one, a compiled `WebAssembly.Module`, or the bytes. The host application knows how it
serves its assets, its bundler, its CDN, and its policy. Comb does not.

## Decision

We will make the engine's WebAssembly a required option of `createComb`, which the host
application hands over as a `Response` or a promise of one, a `WebAssembly.Module`, or its bytes,
and Comb will never resolve, fetch, or inline that file itself.

- **Option:** `CombOptions.engine`. Without it, or with a string, `URL`, or `Request`, which the
  initialiser would fetch, `createComb` rejects with a typed error before it touches the host
  element. The host application makes the request itself, for example `fetch(url)`, and hands
  over the `Response`, so the request is its own and its policy governs it.
- **Package:** `comb` exports the file as `comb/engine.wasm`, so a bundler can resolve it, for
  example with Vite's `?url` import. The library build no longer inlines it. The bundle check
  measures the JavaScript and that file, as Q-3 counts them.
- **Tests:** the Bun suite keeps creating the bridge from the bytes. The example hands over the
  URL its bundler emits.

**Out of scope:** how a host application caches or preloads the file; a WebAssembly-free build of
Comb.

## Alternatives considered

- **Accept a URL and let the initialiser fetch it** — the shortest host code, but the request
  then comes from Comb's code, which is what Q-6 rules out.
- **Default to the file next to the module, with the option as an override** — one line less for
  the host, but every host that sets nothing makes the request Q-6 forbids. Q-6 would have to say
  that loading Comb's own engine is exempt, a change to the specification the maintainer declined.
- **Inline the WebAssembly as base64 in the JavaScript** — no request and no option, but the
  bundle grows by about a third of the file against the 300 kB of Q-3. The browser cannot compile
  while it downloads, and the `data:` URL is still fetched unless it is decoded by hand.
- **`initSync` with bytes Comb ships in its JavaScript** — the same weight as inlining, and it
  compiles synchronously on the UI thread, which delays the first frame of Q-2.

## Sources / Prior art

- The wasm-bindgen initialiser `__wbg_init(module_or_path)` in the generated
  `packages/comb/wasm/engine.js`. Without an argument it builds
  `new URL('engine_bg.wasm', import.meta.url)`. A string, `URL`, or `Request` is passed to `fetch`.
  A `Response`, a `WebAssembly.Module`, or bytes are instantiated directly.
- MDN, `connect-src`: the directive governs `fetch()` —
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src>.
- Vite, static assets: a file is imported as a URL with the `?url` suffix, and an asset below
  `assetsInlineLimit` is inlined as a base64 `data:` URL — <https://vite.dev/guide/assets>.
- Measured: the current `packages/comb/dist/comb.js` carries the engine as a
  `data:application/wasm` URL.

## Consequences

- Positive: Q-6 holds by construction. Comb never takes the path of the initialiser that calls
  `fetch`, and a host application decides under its own policy how the file arrives.
- Positive: the bundle loses the base64 copy of the engine. The browser compiles the file while
  it streams, where the host hands over a `Response`.
- Negative / trade-offs: every host application writes a line or two more, and a missing option
  fails at `createComb`, not at build time. The type of the option rejects a URL at compile time
  too.
- Negative / trade-offs: a breaking change of `createComb` for every host there is, the example
  and the benchmark among them.
- Follow-ups: whether `comb/testing` offers a helper that hands the test page's engine over.

## Enforcement

A Bun test asserts that `createComb` without `engine`, or with a string, a `URL`, or a `Request`,
rejects with the typed error and adds no canvas. A browser test serves the example under the
policy `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`, records every request the page
makes, and asserts that the engine is requested once, by the example, and that nothing else is
requested on Comb's behalf. `scripts/check-bundle.sh` fails a library bundle that contains a
`data:application/wasm` URL. The generated glue keeps its `fetch` branch for strings, so no check
greps for `fetch`; the refusal of the option guards that branch. Each cites this ADR with
`Verifies: ADR-0019`.
