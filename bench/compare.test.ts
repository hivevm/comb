import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineName, compare, gestures, MARGIN, median, usable, type Run } from "./compare";
import { PARTS, type Reference } from "./reference";

const SWIFTSHADER =
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)";

// The CPU models GitHub's runners recorded, as bench/run.ts reads them; each names a runner kind.
const EPYC_7763 = "AMD EPYC 7763 64-Core Processor";
const XEON_8370C = "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz";
/** A CPU model for the Dev Container runs below, that of today's Dev Container; the runs share
 *  it, and only that they share it decides. */
const DEV_CONTAINER = "13th Gen Intel(R) Core(TM) i7-13700";

/** The file name of each kind's baseline, as ADR-0008 derives it, written out. */
const FILE: Record<string, string> = {
  [EPYC_7763]: "amd-epyc-7763-64-core-processor.json",
  [XEON_8370C]: "intel-r-xeon-r-platinum-8370c-cpu-2-80ghz.json",
  [DEV_CONTAINER]: "13th-gen-intel-r-core-tm-i7-13700.json",
};

/** A reference of 80 ms in each part. */
const REFERENCE: Reference = { ms: 240, js: 80, wasm: 80, gpu: 80 };

// Every fixture names the CPU model of a 7763, since a run is compared only with a baseline of the
// same kind; the tests of the kind give it another.
function run(firstFrameMs: number, p95: number, copies = 3334, reference = REFERENCE): Run {
  return {
    copies,
    cpu: EPYC_7763,
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
function bare(full: Run): Run {
  const copy = { ...full };
  delete copy.reference;
  return copy;
}

/** A run with the given numbers, in the order bench/run.ts prints them. */
function measured(reference: Reference, [first, drag, pan, zoom, near, middle]: number[]): Run {
  return {
    ...run(first!, drag!, 3334, reference),
    cpu: DEV_CONTAINER,
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

let dir = "";

/** Runs bench/compare.ts in a directory of its own, on `runs` against `args`, with each of
 *  `baselines` saved under `baselines/` by its kind's file name, and `raw` files saved there as
 *  they are. */
async function command(
  baselines: Run[],
  runs: Run[],
  args = ["baselines"],
  raw: Record<string, string> = {},
) {
  dir = mkdtempSync(join(tmpdir(), "compare-"));
  mkdirSync(join(dir, "baselines"));
  for (const b of baselines) {
    writeFileSync(join(dir, "baselines", FILE[b.cpu!]!), JSON.stringify(b));
  }
  for (const [name, text] of Object.entries(raw)) writeFileSync(join(dir, "baselines", name), text);
  const paths = runs.map((r, i) => {
    writeFileSync(join(dir, `run-${i}.json`), JSON.stringify(r));
    return `run-${i}.json`;
  });
  const child = Bun.spawn(["bun", join(import.meta.dir, "compare.ts"), ...args, ...paths], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GITHUB_ACTIONS: "" },
  });
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code: await child.exited, out, err };
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the command", () => {
  test("exits 0 with a notice against a baseline without a reference", async () => {
    const { code, out } = await command([bare(run(200, 100))], [run(210, 110)]);
    expect(code).toBe(0);
    expect(out).toContain("No reference in the baseline; the runner gate is not checked.");
  });

  test("exits 1 on a comparable runner when a number regressed, naming it", async () => {
    const slow = run(200, 100);
    slow.zoom.p95 = 130;
    const { code, err } = await command([run(200, 100)], [slow]);
    expect(code).toBe(1);
    expect(err).toContain(
      "Regressed by more than 25 %: zoom p95 (ms): 130.0 against 100.0 (+30 %)",
    );
  });

  test("exits 2 on a runner not comparable, with every part's ratio in the log", async () => {
    const { code, out, err } = await command([ALL_CORES], [FOUR_CORES]);
    expect(code).toBe(2);
    expect(err).toContain("Not compared: runner not comparable");
    expect(out).toContain("reference WebAssembly (ms): 82.4 against 79.1 (x1.04)");
  });

  test("writes the median with the CPU model and each gesture's p95, steps, and frames", async () => {
    const counted = (steps: number, frames: number) => {
      const r = run(200, 100);
      for (const [, gesture] of gestures(r)) Object.assign(gesture, { steps, frames });
      return r;
    };
    await command([run(200, 100)], [counted(35, 36), counted(40, 41), counted(37, 38)]);
    const written = JSON.parse(readFileSync(join(dir, "bench-results", "median.json"), "utf8"));
    expect(written.cpu).toBe(EPYC_7763);
    expect(written.drag).toEqual({ p95: 100, steps: 37, frames: 38, truncated: false });
    expect(written.levels.near.pan).toEqual({ p95: 100, steps: 37, frames: 38, truncated: false });
  });
});

// Verifies: ADR-0008 — a run is compared only with the baseline of its runner kind, the CPU model
// it records; a run on a kind without a baseline, or naming no CPU model, is refused.
describe("the runner kind", () => {
  test("a run on another CPU model than the baseline's is refused, naming both", () => {
    const verdict = compare({ ...run(200, 100), cpu: XEON_8370C }, run(200, 100));
    expect(verdict).toEqual({
      kind: "incomparable",
      reason: `the run is on ${XEON_8370C}, the baseline on ${EPYC_7763}`,
    });
  });

  test("a run on the baseline's CPU model is compared by its numbers and the reference", () => {
    expect(compare(run(200, 100), run(200, 100))).toMatchObject({ kind: "compared" });
    const slower = { ms: 312, js: 104, wasm: 104, gpu: 104 };
    expect(compare(run(200, 100, 3334, slower), run(200, 100))).toMatchObject({
      kind: "incomparable",
      reason: expect.stringContaining("runner not comparable"),
    });
  });

  test("a run or a baseline that names no CPU model is refused", () => {
    const none = { ...run(200, 100), cpu: undefined };
    expect(compare(none, run(200, 100))).toMatchObject({
      reason: "the run names no CPU model",
    });
    expect(compare(run(200, 100), none)).toMatchObject({
      reason: "the baseline names no CPU model",
    });
  });

  test("runs on different CPU models have no median, and the median keeps the model", () => {
    expect(median([run(200, 100), { ...run(200, 100), cpu: XEON_8370C }])).toBe(
      `the runs differ: on ${EPYC_7763} and on ${XEON_8370C}`,
    );
    expect(median([run(200, 100), { ...run(200, 100), cpu: undefined }])).toBe(
      `the runs differ: on ${EPYC_7763} and on no CPU model`,
    );
    expect(median([run(200, 100), run(200, 100)])).toMatchObject({ cpu: EPYC_7763 });
  });

  test("a kind's file name is its CPU model in lower case, hyphens for the rest", () => {
    expect(baselineName(EPYC_7763)).toBe("amd-epyc-7763-64-core-processor");
    expect(baselineName(XEON_8370C)).toBe("intel-r-xeon-r-platinum-8370c-cpu-2-80ghz");
  });

  test("a CPU model that starts and ends with a character other than a letter or digit names a file of none at either end", () => {
    // Verifies: ADR-0008
    expect(baselineName(" (Intel) Core i7 @ 3.6GHz ")).toBe("intel-core-i7-3-6ghz");
    expect(baselineName("--AMD Ryzen 9--")).toBe("amd-ryzen-9");
  });

  test("two CPU models of one file name are told apart by the name the baseline records", () => {
    const lookalike = "AMD EPYC 7763 64 Core Processor";
    expect(baselineName(lookalike)).toBe(baselineName(EPYC_7763));
    expect(compare({ ...run(200, 100), cpu: lookalike }, run(200, 100))).toMatchObject({
      kind: "incomparable",
      reason: `the run is on ${lookalike}, the baseline on ${EPYC_7763}`,
    });
  });
});

// Verifies: ADR-0008 — the command picks the baseline of the runs' kind from bench/baselines and
// refuses a kind without one, or runs that name no CPU model, naming the kinds with a baseline.
describe("the command, by runner kind", () => {
  test("picks the baseline of the runs' kind from the directory", async () => {
    const xeon = { ...run(400, 200), cpu: XEON_8370C };
    const { code, out } = await command(
      [run(200, 100), xeon],
      [{ ...run(400, 200), cpu: XEON_8370C }],
    );
    expect(code).toBe(0);
    expect(out).toContain("against baselines/intel-r-xeon-r-platinum-8370c-cpu-2-80ghz.json");
  });

  test("exits 2 on a kind without a baseline, naming it, the kinds with one, and its file", async () => {
    const { code, err } = await command([run(200, 100)], [{ ...run(200, 100), cpu: XEON_8370C }]);
    expect(code).toBe(2);
    expect(err).toContain(`no baseline of the kind ${XEON_8370C}`);
    expect(err).toContain(`kinds with a baseline: ${EPYC_7763}`);
    expect(err).toContain("saved as baselines/intel-r-xeon-r-platinum-8370c-cpu-2-80ghz.json");
  });

  test("exits 2 on runs that name no CPU model, naming the kinds with a baseline", async () => {
    const { code, err } = await command([run(200, 100)], [{ ...run(200, 100), cpu: undefined }]);
    expect(code).toBe(2);
    expect(err).toContain("the runs name no CPU model");
    expect(err).toContain(`kinds with a baseline: ${EPYC_7763}`);
  });

  test("exits 2 when no baseline is at the path given", async () => {
    const { code, err } = await command([], [run(200, 100)], ["missing"]);
    expect(code).toBe(2);
    expect(err).toContain("Not compared: no baseline at missing");
  });

  test("given one baseline file, compares only a run of the CPU model it names", async () => {
    const file = ["baselines/amd-epyc-7763-64-core-processor.json"];
    expect((await command([run(200, 100)], [run(200, 100)], file)).code).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    const other = await command([run(200, 100)], [{ ...run(200, 100), cpu: XEON_8370C }], file);
    expect(other.code).toBe(2);
    expect(other.err).toContain(`the run is on ${XEON_8370C}, the baseline on ${EPYC_7763}`);
  });

  test("exits 2 on a baseline in the directory not JSON or not under its kind's name", async () => {
    const broken = await command([run(200, 100)], [run(200, 100)], ["baselines"], {
      "x.json": "{",
    });
    expect(broken.code).toBe(2);
    expect(broken.err).toContain("the baseline baselines/x.json is not JSON");
    const misnamed = await command([], [run(200, 100)], ["baselines"], {
      "x.json": JSON.stringify(run(200, 100)),
    });
    expect(misnamed.code).toBe(2);
    expect(misnamed.err).toContain(
      `the baseline baselines/x.json names ${EPYC_7763}, ` +
        "whose file is amd-epyc-7763-64-core-processor.json",
    );
  });
});

// Verifies: ADR-0008 — each kind's baseline is a file of its own, named by its CPU model.
describe("bench/baselines", () => {
  test("each recorded baseline names the CPU model its file name derives from", () => {
    const recorded = join(import.meta.dir, "baselines");
    const files = readdirSync(recorded).filter((f) => f.endsWith(".json"));
    expect(files).toContain("amd-epyc-7763-64-core-processor.json");
    for (const f of files) {
      const baseline = JSON.parse(readFileSync(join(recorded, f), "utf8")) as Run;
      expect(`${baselineName(baseline.cpu ?? "")}.json`).toBe(f);
    }
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

describe("the parts of the reference", () => {
  test("usable and the median take every part the reference lists", () => {
    // Verifies: ADR-0008
    for (const [, key] of PARTS) {
      expect(usable({ ...REFERENCE, [key]: Number.NaN })).toBe(false);
      expect(usable({ ...REFERENCE, [key]: 0 })).toBe(false);
    }
    expect(usable(REFERENCE)).toBe(true);
    // Three runs whose parts differ part by part: the median holds each part's middle value.
    const parts = (n: number) =>
      Object.fromEntries(PARTS.map(([, key], i) => [key, n * 10 + i])) as unknown as Reference;
    const result = median([
      run(300, 100, 3334, parts(1)),
      run(300, 100, 3334, parts(3)),
      run(300, 100, 3334, parts(2)),
    ]);
    expect(typeof result).not.toBe("string");
    expect((result as Run).reference).toEqual(parts(2));
  });
});

describe("the edit gesture", () => {
  test("a baseline without it reports the run's edits unjudged, and judges the others", () => {
    // Verifies: ADR-0008, ADR-0022
    const verdict = compare({ ...run(200, 100), edit: { p95: 900 } }, run(200, 100));
    expect(verdict).toMatchObject({ kind: "compared", regressions: [] });
    expect((verdict as { lines: string[] }).lines).toContain("edit p95 (ms): 900.0, no baseline");
    const slower = compare({ ...run(200, 200), edit: { p95: 900 } }, run(200, 100));
    expect((slower as { regressions: string[] }).regressions).toContain(
      "drag p95 (ms): 200.0 against 100.0 (+100 %)",
    );
  });

  test("a baseline with it judges the run's edits as the other gestures", () => {
    // Verifies: ADR-0008, ADR-0022
    const verdict = compare(
      { ...run(200, 100), edit: { p95: 200 } },
      { ...run(200, 100), edit: { p95: 100 } },
    );
    expect((verdict as { regressions: string[] }).regressions).toEqual([
      "edit p95 (ms): 200.0 against 100.0 (+100 %)",
    ]);
    // The median keeps the gesture only where every run has it.
    expect(median([{ ...run(200, 100), edit: { p95: 50 } }, run(200, 100)])).not.toHaveProperty(
      "edit",
    );
    expect(
      median([
        { ...run(200, 100), edit: { p95: 50 } },
        { ...run(200, 100), edit: { p95: 70 } },
      ]),
    ).toMatchObject({ edit: { p95: 60 } });
  });
});
