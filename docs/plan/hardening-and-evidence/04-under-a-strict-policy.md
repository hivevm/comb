# Ticket: Comb runs under a strict Content Security Policy and requests nothing of its own

## What to build

In test mode the example is served with the header
`Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'`, so every
browser test runs under it. A browser test records every request the page makes and every
policy violation, and asserts that the engine is requested once, by the example, and that no
violation occurs. ESLint forbids `eval`, implied eval, and `new Function` in Comb's library
sources. The test cites Q-6 and ADR-0019.

## Acceptance criteria

- [ ] Given the example in test mode, when a page loads, then the response carries the policy
      and the first browser test asserts it.
- [ ] Given that policy, when the graph loads and is panned and zoomed, then no
      `securitypolicyviolation` event fires and the requests are the example's own: its
      documents, scripts, styles, and one request of the engine file.
- [ ] Given Comb's library sources, when ESLint runs, then `no-eval`, `no-implied-eval`, and
      `no-new-func` are errors.
- [ ] Broken once: a `new Function` in the bridge fails the lint and the browser test (policy
      violation); a `fetch` added to `createComb` fails the request assertion.

## Read first

- `docs/SPECIFICATION.md` Q-6; ADR-0019, ADR-0008.
- `playwright.config.ts` and the example's Vite configuration (test mode, port 5174).

## Blocked by

- docs/plan/hardening-and-evidence/03-the-host-hands-over-the-engine.md

## Mode

unattended:
- a test decides its criteria (above);
- scope: the example's test server, a browser test, and the lint configuration; one revert;
- no protected part of ADR-0007: no workflow, no public interface, no validation;
- a wrong result shows as red browser tests, undone by revert; the broken-once runs prove it;
- stop: if PixiJS itself needs `unsafe-eval` under the policy (its shader or ticker code), stop
  at once and hand off with the violation report: that is a finding for the maintainer, not a
  policy to loosen.
