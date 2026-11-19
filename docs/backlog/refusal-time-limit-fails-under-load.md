# A refusal's time limit fails a browser test under load

- **Observed:** the browser test of `examples/metric-tree/e2e/malformed.spec.ts` that refuses a
  title of 50 million characters asserts that the refusal takes less than 500 ms of wall-clock
  time. A full run of `scripts/check-all.sh` on a machine loaded by other work (a load average of
  about 48 on 24 cores) took 521.5 ms there and failed, while the code under test was unchanged:
  the review of ticket 14 of uml-diagrams found it at 2cfb0d39 on 2026-11-19. A limit on elapsed
  time decides by the machine's load as much as by the code, so the test fails at random.
- **Where:** the `REFUSALS` loop of `examples/metric-tree/e2e/malformed.spec.ts`
  (`expect(result.ms).toBeLessThan(500)`) and Q-7, whose budget it checks.
