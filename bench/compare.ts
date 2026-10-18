// Compares benchmark runs with a recorded baseline (ADR-0008). Frame times come in steps of a
// frame and the first frame is a single sample, so one run scatters; the median of each number
// over several runs is compared instead, and may exceed its baseline by at most MARGIN. Runs of
// another size, mode, or GPU than the baseline's are refused rather than compared, and so is a
// run that names no GPU, as one on a fallback renderer would. The median is
// written as bench-results/median.json, the file a new baseline is taken from: a median of runs on
// a GitHub runner, recorded as bench/baseline.json in a pull request that says why.
//
//   bun bench/compare.ts <baseline> <run>...    e.g. bench/baseline.json bench-results/run-*.json
//
// Exit code 0 when no number regressed, or when there is no baseline yet, which it says; 1 when a
// number regressed, naming each; 2 when the runs cannot be compared.
import { mkdirSync, writeFileSync } from "node:fs";

/** How much a number may exceed its baseline: a quarter, the maintainer's margin. */
export const MARGIN = 0.25;

interface Gesture {
  p95: number;
  truncated?: boolean;
}

/** The parts of a run of bench/run.ts that are compared. */
export interface Run {
  copies: number;
  headed?: boolean;
  /** The renderer WebGL reports, as bench/run.ts reads it. */
  gpu?: string;
  load: { nodes: number; firstFrameMs: number };
  drag: Gesture;
  pan: Gesture;
  zoom: Gesture;
  levels?: { near: { pan: Gesture }; middle: { pan: Gesture } };
}

/** The gestures of a run, by the names bench/run.ts prints and a comparison reports. */
export function gestures<G extends Gesture>(run: {
  drag: G;
  pan: G;
  zoom: G;
  levels?: { near: { pan: G }; middle: { pan: G } };
}): [string, G][] {
  return [
    ["drag", run.drag],
    ["pan", run.pan],
    ["zoom", run.zoom],
    ...(run.levels
      ? ([
          ["pan near", run.levels.near.pan],
          ["pan middle", run.levels.middle.pan],
        ] as [string, G][])
      : []),
  ];
}

/** The numbers compared, by the name a regression reports. */
function numbers(run: Run): Record<string, number> {
  return Object.fromEntries([
    ["first frame (ms)", run.load.firstFrameMs],
    ...gestures(run).map(([name, gesture]) => [`${name} p95 (ms)`, gesture.p95]),
  ]);
}

const kind = (run: Run) =>
  `${run.load.nodes} nodes (${run.copies} copies), ${run.headed ? "headed" : "headless"}, on ${run.gpu}`;

/** Why a run cannot be compared at all: it names no GPU it was taken on. */
const unnamed = (run: Run) =>
  !run.gpu || run.gpu === "unknown" ? `a run names no GPU (${run.gpu ?? "none"})` : null;

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

/** The run whose every number is the median of that number over `runs`, which must all be of
 *  one size and mode; or why they are not. */
export function median(runs: Run[]): Run | string {
  const [first] = runs;
  if (!first) return "no run";
  const nameless = runs.map(unnamed).find(Boolean);
  if (nameless) return nameless;
  const other = runs.find((run) => kind(run) !== kind(first));
  if (other) return `the runs differ: ${kind(first)} and ${kind(other)}`;
  const of = (pick: (run: Run) => number) => middle(runs.map(pick));
  const gesture = (pick: (run: Run) => Gesture) => ({
    p95: of((run) => pick(run).p95),
    truncated: runs.some((run) => pick(run).truncated),
  });
  const levels = runs.every((run) => run.levels)
    ? {
        near: { pan: gesture((run) => run.levels!.near.pan) },
        middle: { pan: gesture((run) => run.levels!.middle.pan) },
      }
    : undefined;
  return {
    copies: first.copies,
    headed: first.headed ?? false,
    gpu: first.gpu,
    load: { nodes: first.load.nodes, firstFrameMs: of((run) => run.load.firstFrameMs) },
    drag: gesture((run) => run.drag),
    pan: gesture((run) => run.pan),
    zoom: gesture((run) => run.zoom),
    ...(levels && { levels }),
  };
}

export type Verdict =
  | { kind: "incomparable"; reason: string }
  | { kind: "compared"; regressions: string[]; lines: string[] };

/** One number against its baseline: the line that reports it, and whether it regressed, which
 *  a number does that is not finite or exceeds its baseline by more than `margin`. */
function judge(name: string, value: number, reference: number | undefined, margin: number) {
  if (reference === undefined || !Number.isFinite(reference) || reference <= 0) {
    return { line: `${name}: ${value.toFixed(1)}, no baseline`, regressed: false };
  }
  const change = value / reference - 1;
  const percent = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)} %`;
  const line = `${name}: ${value.toFixed(1)} against ${reference.toFixed(1)} (${percent})`;
  return { line, regressed: !Number.isFinite(value) || change > margin };
}

/** Every number of `run` against `baseline`: a regression where it exceeds the baseline by more
 *  than `margin`. A number the baseline lacks is reported and not compared. */
export function compare(run: Run, baseline: Run, margin = MARGIN): Verdict {
  const nameless = unnamed(run) ?? unnamed(baseline);
  if (nameless) return { kind: "incomparable", reason: nameless };
  if (kind(run) !== kind(baseline)) {
    return {
      kind: "incomparable",
      reason: `the run is ${kind(run)}, the baseline ${kind(baseline)}`,
    };
  }
  const base = numbers(baseline);
  const judged = Object.entries(numbers(run)).map(([name, value]) =>
    judge(name, value, base[name], margin),
  );
  const truncated = gestures(run)
    .filter(([, gesture]) => gesture.truncated)
    .map(([name]) => name);
  return {
    kind: "compared",
    regressions: judged.filter((j) => j.regressed).map((j) => j.line),
    lines: [
      ...judged.map((j) => j.line),
      ...(truncated.length ? [`truncated by the time budget: ${truncated.join(", ")}`] : []),
    ],
  };
}

/** A line for the log, and on GitHub an annotation the run's summary shows. */
function say(level: "notice" | "error", message: string): void {
  const annotate = process.env.GITHUB_ACTIONS ? `::${level}::` : "";
  (level === "error" ? console.error : console.log)(`${annotate}${message}`);
}

async function readRuns(paths: string[]): Promise<Run[] | string> {
  const runs: Run[] = [];
  for (const path of paths) {
    const file = Bun.file(path);
    if (!(await file.exists())) return `no run at ${path}`;
    runs.push(await file.json());
  }
  return runs;
}

async function main(baselinePath: string, runPaths: string[]): Promise<number> {
  const runs = await readRuns(runPaths);
  const run = typeof runs === "string" ? runs : median(runs);
  if (typeof run === "string") {
    say("error", `Not compared: ${run}.`);
    return 2;
  }
  mkdirSync("bench-results", { recursive: true });
  writeFileSync("bench-results/median.json", JSON.stringify(run, null, 2) + "\n");
  const baselineFile = Bun.file(baselinePath);
  if (!(await baselineFile.exists())) {
    say(
      "notice",
      `No baseline at ${baselinePath}; nothing compared. Record one from a runner's median.`,
    );
    return 0;
  }
  const verdict = compare(run, await baselineFile.json());
  if (verdict.kind === "incomparable") {
    say("error", `Not compared: ${verdict.reason}.`);
    return 2;
  }
  console.log(`The median of ${runPaths.length} run(s) against ${baselinePath}:`);
  for (const line of verdict.lines) console.log(`  ${line}`);
  if (verdict.regressions.length === 0) {
    console.log(`No number exceeds its baseline by more than ${MARGIN * 100} %.`);
    return 0;
  }
  for (const line of verdict.regressions)
    say("error", `Regressed by more than ${MARGIN * 100} %: ${line}`);
  return 1;
}

if (import.meta.main) {
  const [baseline = "bench/baseline.json", ...runs] = Bun.argv.slice(2);
  process.exit(await main(baseline, runs.length ? runs : ["bench-results/latest.json"]));
}
