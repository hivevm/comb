# Ticket: The built example runs under the policy too

## What to build

Q-6 is verified against Vite's development server only: the example's Vite configuration sends
the policy from `configureServer` in test mode, and every browser test runs there, on modules
Vite serves one by one. A host application ships a build. The built example, which `vite preview`
serves to the benchmark, is never served under the policy: there Vite's bundler splits PixiJS
into chunks it imports dynamically and preloads, and hashes the engine file, and none of that
runs under the policy in any test.

`vite preview` sends the same policy where it serves the built example for tests, and one browser
test loads, pans, and zooms the built example under it and asserts no `securitypolicyviolation`,
no page error, and no request from Comb's code, as `e2e/policy.spec.ts` does on the development
server. The policy stands in one place for both servers.

## Acceptance criteria

- [ ] Given the built example served by `vite preview` for the test, when a page loads, then the
      response carries the policy of Q-6.
- [ ] Given that policy, when the built example loads, pans, and zooms, then no violation and no
      page error occurs, and the only request beyond the served documents, modules, and
      stylesheet is the example's one request of the engine file (`Verifies: Q-6`).
- [ ] Broken once: a `new Function` in `createBridge`, built, fails the test with the violation.

## Read first

- `docs/SPECIFICATION.md` Q-6; ADR-0019, ADR-0020, ADR-0008 (*Benchmark*).
- `examples/metric-tree/vite.config.ts`, `examples/metric-tree/e2e/policy.spec.ts` (the golden
  path), `playwright.config.ts`, and `bench/run.ts`, which starts `vite preview`.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria (above);
- scope: the example's Vite configuration, the Playwright configuration, and one browser test;
  one revert undoes it;
- cap: it counts as one of the two pieces of open agent work ADR-0007 allows, and starts only
  when fewer than two are open;
- no protected part of ADR-0007: no workflow, no public interface, no validation;
- a wrong result shows as a red or flaky browser test, undone by revert; the broken-once run
  proves it;
- stop: if the built example draws nothing under the policy, stop at once and hand off with the
  violation report: that is a finding on ADR-0020 for the maintainer, not a policy to loosen.
