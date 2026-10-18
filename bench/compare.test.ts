import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, MARGIN, median, usable, type Run } from "./compare";
import type { Reference } from "./reference";

const SWIFTSHADER =
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)";

/** A reference of 80 ms in each part. */
const REFERENCE: Reference = { ms: 240, js: 80, wasm: 80, gpu: 80 };

function run(firstFrameMs: number, p95: number, copies = 3334, reference = REFERENCE): Run {
  return {
    copies,
    gpu: SWIFTSHADER,
    reference,
    load: { nodes: copies * 15, firstFrameMs },
    drag: { p95 },
    pan: { p95 },
    zoom: { p95 },
    levels: { near: { pan: { p95 } }, middle: { pan: { p95 } } },
  };
}

/** The run without a reference, as one recorded before the reference existed. */
function bare(run: Run): Run {
  const copy = { ...run };
  delete copy.reference;
  return copy;
}

/** A run with the given numbers, in the order bench/run.ts prints them. */
function measured(reference: Reference, [first, drag, pan, zoom, near, middle]: number[]): Run {
  return {
    ...run(first!, drag!, 3334, reference),
    pan: { p95: pan! },
    zoom: { p95: zoom! },
    levels: { near: { pan: { p95: near! } }, middle: { pan: { p95: middle! } } },
  };
}

// Two runs of the benchmark in the Dev Container, copied as input: on all 24 cores, and limited
// to 4 cores, a GitHub runner's size, with taskset.
const ALL_CORES = measured(
  { ms: 216.5, js: 79.0, wasm: 79.1, gpu: 58.4 },
  [186.2, 116.7, 100.1, 100.0, 100.0, 116.7],
);
const FOUR_CORES = measured(
  { ms: 467.0, js: 80.7, wasm: 82.4, gpu: 303.9 },
  [232.5, 200.1, 183.5, 183.3, 166.6, 116.7],
);

describe("compare", () => {
  test("numbers within the margin pass", () => {
    const verdict = compare(run(200 * (1 + MARGIN), 100), run(200, 100));
    expect(verdict).toMatchObject({ kind: "compared", regressions: [] });
  });

  test("a number beyond the margin is a regression that names it", () => {
    const slow = run(200, 100);
    slow.pan.p95 = 126;
    const verdict = compare(slow, run(200, 100));
    expect(verdict.kind).toBe("compared");
    if (verdict.kind !== "compared") return;
    expect(verdict.regressions).toEqual(["pan p95 (ms): 126.0 against 100.0 (+26 %)"]);
  });

  test("faster numbers pass", () => {
    expect(compare(run(100, 50), run(200, 100))).toMatchObject({ regressions: [] });
  });

  test("a run of another size is not compared", () => {
    const verdict = compare(run(200, 100, 100), run(200, 100));
    expect(verdict).toEqual({
      kind: "incomparable",
      reason:
        `the run is 1500 nodes (100 copies), headless, on ${SWIFTSHADER}, ` +
        `the baseline 50010 nodes (3334 copies), headless, on ${SWIFTSHADER}`,
    });
  });

  test("a number the baseline lacks is reported, not compared", () => {
    const old = run(200, 100);
    delete old.levels;
    const verdict = compare(run(200, 1000), old);
    if (verdict.kind !== "compared") throw new Error("not compared");
    expect(verdict.regressions).toHaveLength(3);
    expect(verdict.lines).toContain("pan near p95 (ms): 1000.0, no baseline");
  });

  test("a number that is not finite is a regression", () => {
    const broken = run(200, 100);
    broken.drag.p95 = Number.NaN;
    const verdict = compare(broken, run(200, 100));
    if (verdict.kind !== "compared") throw new Error("not compared");
    expect(verdict.regressions).toEqual([expect.stringContaining("drag p95 (ms): NaN")]);
  });

  test("a headed run is not compared with a headless baseline", () => {
    const headed = { ...run(200, 100), headed: true };
    expect(compare(headed, run(200, 100)).kind).toBe("incomparable");
  });

  test("a gesture cut short by the time budget is reported", () => {
    const short = run(200, 100);
    short.drag.truncated = true;
    const verdict = compare(short, run(200, 100));
    if (verdict.kind !== "compared") throw new Error("not compared");
    expect(verdict.lines).toContain("truncated by the time budget: drag");
  });

  test("a level pan cut short by the time budget is reported by its name", () => {
    const short = run(200, 100);
    short.levels!.near.pan.truncated = true;
    const verdict = compare(short, run(200, 100));
    if (verdict.kind !== "compared") throw new Error("not compared");
    expect(verdict.lines).toContain("truncated by the time budget: pan near");
  });
});

// Verifies: ADR-0008 — the runner gate: a run whose reference differs from the baseline's by
// more than the margin in any part is refused; the numbers are compared raw.
describe("the runner gate", () => {
  test("a runner within the margin in every part is compared, raw, with each part reported", () => {
    // Each part 20 % slower; the numbers themselves unchanged, so nothing regresses.
    const slower = { ms: 288, js: 96, wasm: 96, gpu: 96 };
    const verdict = compare(run(200, 100, 3334, slower), run(200, 100));
    expect(verdict).toMatchObject({ kind: "compared", regressions: [] });
    if (verdict.kind !== "compared") return;
    expect(verdict.lines).toContain("reference WebGL2 (ms): 96.0 against 80.0 (x1.20)");
    expect(verdict.lines).toContain("reference sum (ms): 288.0 against 240.0 (x1.20)");
  });

  test("a runner of four cores is refused against a baseline of 24, naming WebGL2", () => {
    // WebGL2 303.9 against 58.4 is x5.20; JavaScript x1.02 and WebAssembly x1.04 lie within.
    const verdict = compare(FOUR_CORES, ALL_CORES);
    expect(verdict.kind).toBe("incomparable");
    if (verdict.kind !== "incomparable") return;
    expect(verdict.reason).toBe(
      "runner not comparable, its reference differs by more than 25 %: " +
        "reference WebGL2 (ms): 303.9 against 58.4 (x5.20)",
    );
    expect(verdict.lines).toContain("reference JavaScript (ms): 80.7 against 79.0 (x1.02)");
  });

  test("a faster runner is refused as well", () => {
    const faster = { ms: 196, js: 80, wasm: 80, gpu: 36 };
    expect(compare(run(200, 100, 3334, faster), run(200, 100))).toMatchObject({
      kind: "incomparable",
    });
  });

  test("a part that moved alone is refused though the sum stays within the margin", () => {
    // JavaScript x1.375, WebGL2 x0.69; the sum 245 against 240 is x1.02.
    const skewed = { ms: 245, js: 110, wasm: 80, gpu: 55 };
    const verdict = compare(run(200, 100, 3334, skewed), run(200, 100));
    expect(verdict.kind).toBe("incomparable");
    if (verdict.kind !== "incomparable") return;
    expect(verdict.reason).toContain("reference JavaScript (ms): 110.0 against 80.0 (x1.38)");
    expect(verdict.reason).toContain("reference WebGL2 (ms): 55.0 against 80.0 (x0.69)");
  });
});

// Verifies: ADR-0008 — a run without a reference is refused against a baseline with one; a
// baseline without one is compared raw, and the gate reported as not checked.
describe("without a usable reference", () => {
  test("a reference is usable only when its sum and parts are positive and finite", () => {
    expect(usable(REFERENCE)).toBe(true);
    expect(usable(undefined)).toBe(false);
    expect(usable({ ...REFERENCE, ms: 0 })).toBe(false);
    expect(usable({ ...REFERENCE, ms: Number.NaN })).toBe(false);
    expect(usable({ ...REFERENCE, ms: -240 })).toBe(false);
    expect(usable({ ...REFERENCE, js: Number.POSITIVE_INFINITY })).toBe(false);
    expect(usable({ ...REFERENCE, gpu: 0 })).toBe(false);
  });

  test("a run without a reference is refused against a baseline with one", () => {
    expect(compare(bare(run(200, 100)), run(200, 100))).toEqual({
      kind: "incomparable",
      reason: "the run carries no usable reference",
      lines: [],
    });
    const unusable = run(200, 100, 3334, { ...REFERENCE, wasm: -1 });
    expect(compare(run(200, 100), unusable)).toMatchObject({
      reason: "the baseline's reference is unusable",
    });
    const broken = run(200, 100, 3334, { ...REFERENCE, ms: Number.NaN });
    expect(compare(broken, run(200, 100))).toMatchObject({ kind: "incomparable" });
  });

  test("against a baseline without a reference the numbers are compared raw, with a notice", () => {
    const verdict = compare(run(200, 126), bare(run(200, 100)));
    expect(verdict).toMatchObject({
      kind: "compared",
      notice: "no reference in the baseline; the runner gate is not checked",
    });
    if (verdict.kind !== "compared") return;
    expect(verdict.regressions).toHaveLength(5);
    expect(compare(bare(run(200, 100)), bare(run(200, 100)))).toMatchObject({
      notice: "no reference in the run or the baseline; the runner gate is not checked",
    });
  });

  test("the median keeps every part of the reference, and runs with and without one differ", () => {
    // Each part has a median of its own: JavaScript 80, WebAssembly 20, WebGL2 200, sum 300.
    const middle = median([
      run(200, 100, 3334, { ms: 380, js: 70, wasm: 10, gpu: 300 }),
      run(200, 100, 3334, { ms: 220, js: 90, wasm: 30, gpu: 100 }),
      run(200, 100, 3334, { ms: 300, js: 80, wasm: 20, gpu: 200 }),
    ]);
    if (typeof middle === "string") throw new Error(middle);
    expect(middle.reference).toEqual({ ms: 300, js: 80, wasm: 20, gpu: 200 });
    expect(median([run(200, 100), bare(run(200, 100))])).toBe(
      "the runs differ: 1 of 2 carry a reference",
    );
  });
});

describe("a number that is not finite in one run", () => {
  test("makes that part of the median reference unusable, and the run is refused", () => {
    const broken = run(200, 100, 3334, { ...REFERENCE, gpu: Number.NaN });
    const middle = median([broken, run(200, 100), run(200, 100)]);
    if (typeof middle === "string") throw new Error(middle);
    expect(middle.reference!.gpu).toBeNaN();
    expect(compare(middle, run(200, 100))).toMatchObject({
      kind: "incomparable",
      reason: "the run carries no usable reference",
    });
  });

  test("makes that number of the median a regression", () => {
    const broken = run(200, 100);
    broken.zoom.p95 = Number.NaN;
    const middle = median([broken, run(200, 100), run(200, 100)]);
    if (typeof middle === "string") throw new Error(middle);
    const verdict = compare(middle, run(200, 100));
    if (verdict.kind !== "compared") throw new Error("not compared");
    expect(verdict.regressions).toEqual([expect.stringContaining("zoom p95 (ms): NaN")]);
  });
});

describe("the command", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs bench/compare.ts on `baseline` and `runs`, written to a directory of their own. */
  async function command(baseline: Run, runs: Run[]) {
    dir = mkdtempSync(join(tmpdir(), "compare-"));
    writeFileSync(join(dir, "baseline.json"), JSON.stringify(baseline));
    const paths = runs.map((r, i) => {
      writeFileSync(join(dir, `run-${i}.json`), JSON.stringify(r));
      return `run-${i}.json`;
    });
    const child = Bun.spawn(
      ["bun", join(import.meta.dir, "compare.ts"), "baseline.json", ...paths],
      {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, GITHUB_ACTIONS: "" },
      },
    );
    const [out, err] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code: await child.exited, out, err };
  }

  test("exits 0 with a notice against a baseline without a reference", async () => {
    const { code, out } = await command(bare(run(200, 100)), [run(210, 110)]);
    expect(code).toBe(0);
    expect(out).toContain("No reference in the baseline; the runner gate is not checked.");
  });

  test("exits 1 on a comparable runner when a number regressed, naming it", async () => {
    const slow = run(200, 100);
    slow.zoom.p95 = 130;
    const { code, err } = await command(run(200, 100), [slow]);
    expect(code).toBe(1);
    expect(err).toContain(
      "Regressed by more than 25 %: zoom p95 (ms): 130.0 against 100.0 (+30 %)",
    );
  });

  test("exits 2 on a runner not comparable, with every part's ratio in the log", async () => {
    const { code, out, err } = await command(ALL_CORES, [FOUR_CORES]);
    expect(code).toBe(2);
    expect(err).toContain("Not compared: runner not comparable");
    expect(out).toContain("reference WebAssembly (ms): 82.4 against 79.1 (x1.04)");
  });
});

describe("median", () => {
  test("every number is the median over the runs, so one slow run does not regress", () => {
    const runs = [run(200, 100), run(900, 150), run(210, 116.7)];
    const middle = median(runs);
    if (typeof middle === "string") throw new Error(middle);
    expect(middle.load.firstFrameMs).toBe(210);
    expect(middle.pan.p95).toBe(116.7);
    expect(compare(middle, run(200, 100))).toMatchObject({ regressions: [] });
  });

  test("runs of different sizes have no median", () => {
    expect(median([run(200, 100), run(200, 100, 100)])).toContain("the runs differ");
    expect(median([])).toBe("no run");
  });

  test("runs and baselines of different GPUs are not compared, and both are named", () => {
    const laptop = { ...run(200, 100), gpu: "ANGLE (Intel, Iris Xe)" };
    const verdict = compare(laptop, run(200, 100));
    expect(verdict.kind).toBe("incomparable");
    if (verdict.kind !== "incomparable") return;
    expect(verdict.reason).toContain("Iris Xe");
    expect(verdict.reason).toContain("SwiftShader");
  });

  test("a run or a baseline that names no GPU is refused", () => {
    const unknown = { ...run(200, 100), gpu: "unknown" };
    const none = { ...run(200, 100), gpu: undefined };
    expect(compare(unknown, run(200, 100))).toMatchObject({ kind: "incomparable" });
    expect(compare(run(200, 100), none)).toMatchObject({ kind: "incomparable" });
    expect(median([run(200, 100), unknown])).toBe("a run names no GPU (unknown)");
  });
});
