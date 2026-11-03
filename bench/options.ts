// The options of a benchmark run taken from its environment: which browser it measures in, one it
// launches or one started outside it whose debugging port it attaches to (ADR-0028), and by what
// factor it slows the measured page's CPU (ADR-0029). Each refuses a value it cannot take, before
// anything is measured.

/** Where the run measures: in a Chromium it launches, or attached to the browser whose debugging
 *  port `endpoint` names. */
export type Browser = { kind: "launch" } | { kind: "attach"; endpoint: string };

/** The browser `BENCH_CDP` asks for: none set launches Chromium; an `http` or `https` address of a
 *  host and a port attaches there, its origin alone; anything else is refused. */
export function browserFor(env: Record<string, string | undefined>): Browser {
  const value = env.BENCH_CDP;
  if (value === undefined || value === "") return { kind: "launch" };
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname || !url.port)
    throw new Error(
      `BENCH_CDP is ${JSON.stringify(value)}, not the http address of a host and port`,
    );
  return { kind: "attach", endpoint: url.origin };
}

/** The factor `BENCH_CPU_THROTTLE` slows the measured page's CPU by: 1, none slowed, where it is
 *  not set; a finite number of at least 1 as it is; anything else is refused. */
export function cpuThrottleFor(env: Record<string, string | undefined>): number {
  const value = env.BENCH_CPU_THROTTLE;
  if (value === undefined || value === "") return 1;
  const factor = Number(value);
  if (!Number.isFinite(factor) || factor < 1)
    throw new Error(`BENCH_CPU_THROTTLE is ${JSON.stringify(value)}, not a factor of at least 1`);
  return factor;
}
