// Compares benchmark runs with a recorded baseline (ADR-0008). Frame times come in steps of a
// frame and the first frame is a single sample, so one run scatters; the median of each number
// over several runs is compared instead, and may exceed its baseline by at most MARGIN. Runners
// differ in speed, so a runner gate comes first: each part of the reference workload timed in the
// run (bench/reference.ts) may differ from the baseline's by at most MARGIN, or the run is refused
// as taken on a runner not comparable with the baseline's. The reference decides only whether to
// compare, never by how much a number moved. Runs of another size, mode, or GPU than the
// baseline's are refused as well, and so is a run that names no GPU, as one on a fallback
// renderer would, and a run without a reference against a baseline with one. Against a baseline
// without a reference the numbers are compared and the gate is reported as not checked. The
// median is written as bench-results/median.json, the file a new baseline is taken from: a
// median of runs on a GitHub runner, recorded as bench/baseline.json in a pull request that
// says why.
//
//   bun bench/compare.ts <baseline> <run>...    e.g. bench/baseline.json bench-results/run-*.json
//
// Exit code 0 when no number regressed, or when there is no baseline yet, which it says; 1 when a
// number regressed, naming each; 2 when the runs cannot be compared, the runner gate included.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Reference } from "./reference";

/** How much a number may exceed its baseline, and a part of the reference differ from the
 *  baseline's: a quarter, the maintainer's margin. */
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
  /** The reference workload of the run, in milliseconds; absent in a run recorded without it. */
  reference?: Reference;
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

/** The median of `values`, or NaN when one is not finite, so that a broken number is not hidden
 *  by the others: a NaN number regresses, a NaN part of the reference is unusable. */
function middle(values: number[]): number {
  if (!values.every(Number.isFinite)) return Number.NaN;
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
  const referenced = runs.filter((run) => run.reference).length;
  if (referenced && referenced < runs.length) {
    return `the runs differ: ${referenced} of ${runs.length} carry a reference`;
  }
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
    ...(referenced && {
      reference: {
        ms: of((run) => run.reference!.ms),
        js: of((run) => run.reference!.js),
        wasm: of((run) => run.reference!.wasm),
        gpu: of((run) => run.reference!.gpu),
      },
    }),
    load: { nodes: first.load.nodes, firstFrameMs: of((run) => run.load.firstFrameMs) },
    drag: gesture((run) => run.drag),
    pan: gesture((run) => run.pan),
    zoom: gesture((run) => run.zoom),
    ...(levels && { levels }),
  };
}

export type Verdict =
  | { kind: "incomparable"; reason: string; lines?: string[] }
  | { kind: "compared"; regressions: string[]; lines: string[]; notice?: string };

/** A reference whose sum and parts are all positive, finite times. */
export function usable(reference: Reference | undefined): reference is Reference {
  if (!reference) return false;
  const times = [reference.ms, reference.js, reference.wasm, reference.gpu];
  return times.every((ms) => Number.isFinite(ms) && ms > 0);
}

const PARTS = [
  ["sum", "ms"],
  ["JavaScript", "js"],
  ["WebAssembly", "wasm"],
  ["WebGL2", "gpu"],
] as const;

/** The runner gate: each part of the run's reference against the baseline's, as a line for the
 *  log, and the parts whose ratio differs from 1 by more than `margin`, either way. The sum is
 *  reported and decides nothing, since a part that moved alone can hide in it. */
function gate(run: Reference, base: Reference, margin: number) {
  const judged = PARTS.map(([name, key]) => {
    const ratio = run[key] / base[key];
    const line = `reference ${name} (ms): ${run[key].toFixed(1)} against ${base[key].toFixed(1)} (x${ratio.toFixed(2)})`;
    return { key, line, off: key !== "ms" && Math.abs(ratio - 1) > margin };
  });
  return {
    lines: judged.map((j) => j.line),
    off: judged.filter((j) => j.off).map((j) => j.line),
  };
}

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

/** Whether the run's runner can be compared with the baseline's, by their references: the lines
 *  of the gate, and why not, or the notice that the gate could not be checked. */
function runner(run: Run, baseline: Run, margin: number) {
  if (baseline.reference === undefined && run.reference === undefined) {
    return { lines: [], notice: "no reference in the run or the baseline" };
  }
  if (baseline.reference === undefined) {
    return { lines: [], notice: "no reference in the baseline" };
  }
  if (!usable(baseline.reference))
    return { lines: [], refused: "the baseline's reference is unusable" };
  if (!usable(run.reference)) return { lines: [], refused: "the run carries no usable reference" };
  const { lines, off } = gate(run.reference, baseline.reference, margin);
  return off.length
    ? {
        lines,
        refused: `runner not comparable, its reference differs by more than ${margin * 100} %: ${off.join("; ")}`,
      }
    : { lines };
}

/** Every number of `run` against `baseline`: a regression where it exceeds the baseline by more
 *  than `margin`. A number the baseline lacks is reported and not compared. The runner gate
 *  comes first: a run whose reference differs from the baseline's by more than `margin` in any
 *  part is refused, since its numbers would judge the runner. */
export function compare(run: Run, baseline: Run, margin = MARGIN): Verdict {
  const nameless = unnamed(run) ?? unnamed(baseline);
  if (nameless) return { kind: "incomparable", reason: nameless };
  if (kind(run) !== kind(baseline)) {
    return {
      kind: "incomparable",
      reason: `the run is ${kind(run)}, the baseline ${kind(baseline)}`,
    };
  }
  const gated: { lines: string[]; refused?: string; notice?: string } = runner(
    run,
    baseline,
    margin,
  );
  if (gated.refused) return { kind: "incomparable", reason: gated.refused, lines: gated.lines };
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
      ...gated.lines,
      ...judged.map((j) => j.line),
      ...(truncated.length ? [`truncated by the time budget: ${truncated.join(", ")}`] : []),
    ],
    ...(gated.notice && { notice: `${gated.notice}; the runner gate is not checked` }),
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
  console.log(`The median of ${runPaths.length} run(s) against ${baselinePath}:`);
  for (const line of verdict.lines ?? []) console.log(`  ${line}`);
  if (verdict.kind === "incomparable") {
    say("error", `Not compared: ${verdict.reason}.`);
    return 2;
  }
  if (verdict.notice)
    say("notice", `${verdict.notice[0]!.toUpperCase()}${verdict.notice.slice(1)}.`);
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
