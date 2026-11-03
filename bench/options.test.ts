// The options a benchmark run takes from its environment (ADR-0028, ADR-0029).
import { expect, test } from "bun:test";
import { browserFor, cpuThrottleFor } from "./options";

test("without BENCH_CDP the run launches Chromium, and with it attaches to the address it gives", () => {
  // Verifies: ADR-0028
  expect(browserFor({})).toEqual({ kind: "launch" });
  expect(browserFor({ BENCH_CDP: "" })).toEqual({ kind: "launch" });
  expect(browserFor({ BENCH_CDP: "http://host.docker.internal:9223/" })).toEqual({
    kind: "attach",
    endpoint: "http://host.docker.internal:9223",
  });
});

test("BENCH_CDP that is not the http address of a host and port is refused", () => {
  // Verifies: ADR-0028
  for (const value of ["host.docker.internal:9223", "ws://localhost:9222", "http://localhost", "x"])
    expect(() => browserFor({ BENCH_CDP: value })).toThrow("BENCH_CDP");
});

test("BENCH_CPU_THROTTLE slows by its factor, 1 without it, and refuses one below 1 or not finite", () => {
  // Verifies: ADR-0029
  expect(cpuThrottleFor({})).toBe(1);
  expect(cpuThrottleFor({ BENCH_CPU_THROTTLE: "2" })).toBe(2);
  expect(cpuThrottleFor({ BENCH_CPU_THROTTLE: "1.5" })).toBe(1.5);
  for (const value of ["0.5", "0", "-2", "Infinity", "NaN", "fast"])
    expect(() => cpuThrottleFor({ BENCH_CPU_THROTTLE: value })).toThrow("BENCH_CPU_THROTTLE");
});
