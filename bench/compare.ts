// Compares benchmark runs with the baseline of their runner kind (ADR-0008). Frame times come in
// steps of a frame and the first frame is a single sample, so one run scatters; the median of each
// number over several runs is compared instead, and may exceed its baseline by at most MARGIN.
// Runner kinds differ in ways no reference predicts, so the kind, the CPU model a run records,
// comes first: each kind has a baseline of its own, bench/baselines/<kind>.json, named by
// baselineName, and a run is compared only with a baseline that names the same CPU model. A run
// on a kind without a baseline is refused, naming the kind, the kinds that have one, and the file
// its baseline would be saved as; so is a run that names no CPU model. Within a kind a runner gate
// follows: each part of the reference workload timed in the run (bench/reference.ts) may differ
// from the baseline's by at most MARGIN, or the run is refused as taken on a runner not in the
// state the baseline was taken in. The reference decides only whether to compare, never by how
// much a number moved. Runs of another size, mode, or GPU than the baseline's are refused as well,
// and so is a run that names no GPU, as one on a fallback renderer would, and a run without a
// reference against a baseline with one. Against a baseline without a reference the numbers are
// compared and the gate is reported as not checked. The median, with the CPU model and each
// gesture's steps and frames, is written as bench-results/median.json, the file a new baseline is
// taken from: a median of runs on `main` on a GitHub runner of that kind, saved under the file
// name the refusal prints in a pull request that says why.
//
//   bun bench/compare.ts <baselines> <run>...    e.g. bench/baselines bench-results/run-*.json
//   bun bench/compare.ts <baseline> <run>...     one baseline file, of the runs' CPU model
//
// Exit code 0 when no number regressed; 1 when a number regressed, naming each; 2 when the runs
// cannot be compared, the runner kind and the runner gate included.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PARTS, type Reference } from "./reference";

/** How much a number may exceed its baseline, and a part of the reference differ from the
 *  baseline's: a quarter, the maintainer's margin. */
export const MARGIN = 0.25;

interface Gesture {
  p95: number;
  /** Gesture steps sent, and frame intervals in which Comb rendered; absent in older runs. */
  steps?: number;
  frames?: number;
  truncated?: boolean;
}

/** The levels of detail (ADR-0027), in the order a run lists them. */
export const LEVELS = ["near", "middle", "far"] as const;

/** The gestures timed at a level of detail, in the order a run lists them. An older run timed
 *  the pan alone, at the near and the middle level. */
interface AtLevel<G> {
  pan: G;
  drag?: G;
  zoom?: G;
  edit?: G;
}

/** The gestures of a run at each level of detail. Where the fitted view the example opens with
 *  draws far, its gestures are far's, and far holds the zoom alone. */
type Levels<G> = { near: AtLevel<G>; middle: AtLevel<G>; far?: Partial<AtLevel<G>> };

/** The content a run loaded, as the example counts it: nodes by type, elements by kind. */
export interface Content {
  nodes: Record<string, number>;
  elements: Record<string, number>;
}

/** The parts of a run of bench/run.ts that are compared. */
export interface Run {
  copies: number;
  headed?: boolean;
  /** The CPU model of the runner, as bench/run.ts reads it: the runner's kind. */
  cpu?: string;
  /** The renderer WebGL reports, as bench/run.ts reads it. */
  gpu?: string;
  /** The reference workload of the run, in milliseconds; absent in a run recorded without it. */
  reference?: Reference;
  /** The content is absent in a run recorded before it was named. */
  load: { nodes: number; firstFrameMs: number; content?: Content };
  drag: Gesture;
  pan: Gesture;
  zoom: Gesture;
  levels?: Levels<Gesture>;
  /** Edits, one a frame: a node and an edge added and removed again (ADR-0022); absent in a run
   *  recorded before the gesture, whose baseline then reports it unjudged. */
  edit?: Gesture;
}

/** The gestures of a run, by the names bench/run.ts prints and a comparison reports: those at
 *  the view the example opens with by their own names, and those at a level of detail by the
 *  gesture's name and the level's, such as `drag near`; each where the run timed it. */
export function gestures<G extends Gesture>(run: {
  drag: G;
  pan: G;
  zoom: G;
  levels?: Levels<G>;
  edit?: G;
}): [string, G][] {
  const named: [string, G | undefined][] = [
    ["drag", run.drag],
    ["pan", run.pan],
    ["zoom", run.zoom],
    ["edit", run.edit],
  ];
  for (const level of LEVELS) {
    const at = run.levels?.[level];
    for (const gesture of ["drag", "pan", "zoom", "edit"] as const) {
      named.push([`${gesture} ${level}`, at?.[gesture]]);
    }
  }
  return named.filter((entry): entry is [string, G] => entry[1] !== undefined);
}

/** The numbers compared, by the name a regression reports. */
function numbers(run: Run): Record<string, number> {
  return Object.fromEntries([
    ["first frame (ms)", run.load.firstFrameMs],
    ...gestures(run).map(([name, gesture]) => [`${name} p95 (ms)`, gesture.p95]),
  ]);
}

/** The size, mode, and GPU of a run, which a comparison and a median require to be the same. */
const setting = (run: Run) =>
  `${run.load.nodes} nodes (${run.copies} copies), ${run.headed ? "headed" : "headless"}, on ${run.gpu}`;

/** The content a run names, as bench/run.ts prints it: nodes by type, then elements by kind. */
export const contentOf = ({ nodes, elements }: Content) =>
  [nodes, elements]
    .map((counts) =>
      Object.entries(counts)
        .map(([name, count]) => `${count} ${name}`)
        .join(", "),
    )
    .join("; ");

/** The runner kind of a run, as a comparison names it. */
const on = (run: Run) => (run.cpu ? `on ${run.cpu}` : "on no CPU model");

/** The file name of a kind's baseline, without `.json`: the CPU model in lower case, every run of
 *  characters other than a–z and 0–9 one hyphen, and no hyphen at either end. Two models may
 *  share a name; the baseline names its model, and a comparison holds it to the run's. */
export function baselineName(cpu: string): string {
  return cpu
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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

/** Why `runs` have no median: one names no GPU, or they differ in kind, size, mode, GPU, or in
 *  carrying a reference; or null. */
function differ(runs: Run[], first: Run): string | null {
  const nameless = runs.map(unnamed).find(Boolean);
  if (nameless) return nameless;
  const elsewhere = runs.find((run) => run.cpu !== first.cpu);
  if (elsewhere) return `the runs differ: ${on(first)} and ${on(elsewhere)}`;
  const other = runs.find((run) => setting(run) !== setting(first));
  if (other) return `the runs differ: ${setting(first)} and ${setting(other)}`;
  const referenced = runs.filter((run) => run.reference).length;
  return referenced && referenced < runs.length
    ? `the runs differ: ${referenced} of ${runs.length} carry a reference`
    : null;
}

/** The median of a count over `runs`, or undefined when a run lacks it, as an older one does. */
function counted(runs: Run[], count: (run: Run) => number | undefined): number | undefined {
  return runs.every((run) => count(run) !== undefined)
    ? middle(runs.map((run) => count(run)!))
    : undefined;
}

/** The median of one gesture over `runs`: its p95, steps, and frames, and whether any run was
 *  cut short. */
function gestureMedian(runs: Run[], pick: (run: Run) => Gesture): Gesture {
  const steps = counted(runs, (run) => pick(run).steps);
  const frames = counted(runs, (run) => pick(run).frames);
  return {
    p95: middle(runs.map((run) => pick(run).p95)),
    ...(steps !== undefined && { steps }),
    ...(frames !== undefined && { frames }),
    truncated: runs.some((run) => pick(run).truncated),
  };
}

/** The median of the gestures at each level over `runs`: a level, and a gesture at it, only where
 *  every run timed it; none where the near or the middle level is missing. */
function levelsMedian(runs: Run[]): Levels<Gesture> | undefined {
  const atLevel = (level: (typeof LEVELS)[number]) => {
    if (!runs.every((run) => run.levels?.[level])) return undefined;
    const at = (run: Run) => run.levels![level]!;
    const kept = (["drag", "pan", "zoom", "edit"] as const).filter((name) =>
      runs.every((run) => at(run)[name]),
    );
    return Object.fromEntries(
      kept.map((name) => [name, gestureMedian(runs, (run) => at(run)[name]!)]),
    ) as unknown as AtLevel<Gesture>;
  };
  const [near, between, far] = LEVELS.map(atLevel);
  return near && between ? { near, middle: between, ...(far && { far }) } : undefined;
}

/** The run whose every number is the median of that number over `runs`, which must all be of
 *  one kind, size, and mode; or why they are not. */
export function median(runs: Run[]): Run | string {
  const [first] = runs;
  if (!first) return "no run";
  const differs = differ(runs, first);
  if (differs) return differs;
  const referenced = Boolean(first.reference);
  const of = (pick: (run: Run) => number) => middle(runs.map(pick));
  const gesture = (pick: (run: Run) => Gesture) => gestureMedian(runs, pick);
  const levels = levelsMedian(runs);
  return {
    copies: first.copies,
    headed: first.headed ?? false,
    ...(first.cpu && { cpu: first.cpu }),
    gpu: first.gpu,
    ...(referenced && {
      reference: Object.fromEntries(
        PARTS.map(([, key]) => [key, of((run) => run.reference![key])]),
      ) as unknown as Reference,
    }),
    load: {
      nodes: first.load.nodes,
      firstFrameMs: of((run) => run.load.firstFrameMs),
      ...(first.load.content && { content: first.load.content }),
    },
    drag: gesture((run) => run.drag),
    pan: gesture((run) => run.pan),
    zoom: gesture((run) => run.zoom),
    ...(levels && { levels }),
    ...(runs.every((run) => run.edit) && { edit: gesture((run) => run.edit!) }),
  };
}

export type Verdict =
  | { kind: "incomparable"; reason: string; lines?: string[] }
  | { kind: "compared"; regressions: string[]; lines: string[]; notice?: string };

/** A reference whose sum and parts are all positive, finite times. */
export function usable(reference: Reference | undefined): reference is Reference {
  if (!reference) return false;
  return PARTS.every(([, key]) => Number.isFinite(reference[key]) && reference[key] > 0);
}

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

/** Why `run` cannot be compared with `baseline` before any number: either names no CPU model or
 *  no GPU, or they differ in CPU model, size, mode, or GPU; or null. */
function mismatch(run: Run, baseline: Run): string | null {
  if (!run.cpu) return "the run names no CPU model";
  if (!baseline.cpu) return "the baseline names no CPU model";
  if (run.cpu !== baseline.cpu) return `the run is ${on(run)}, the baseline ${on(baseline)}`;
  const nameless = unnamed(run) ?? unnamed(baseline);
  if (nameless) return nameless;
  return setting(run) !== setting(baseline)
    ? `the run is ${setting(run)}, the baseline ${setting(baseline)}`
    : null;
}

/** Every number of `run` against `baseline`: a regression where it exceeds the baseline by more
 *  than `margin`. A number the baseline lacks, as a gesture newer than the baseline, is reported
 *  and not compared, and the gestures it belongs to are listed as new. The runner kind comes
 *  first: a run is compared only with a baseline of the same CPU model. The runner gate follows:
 *  a run whose reference differs from the baseline's by more than `margin` in any part is
 *  refused, since its numbers would judge the runner. */
export function compare(run: Run, baseline: Run, margin = MARGIN): Verdict {
  const unlike = mismatch(run, baseline);
  if (unlike) return { kind: "incomparable", reason: unlike };
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
  const known = new Set(gestures(baseline).map(([name]) => name));
  const fresh = gestures(run)
    .map(([name]) => name)
    .filter((name) => !known.has(name));
  return {
    kind: "compared",
    regressions: judged.filter((j) => j.regressed).map((j) => j.line),
    lines: [
      ...gated.lines,
      ...judged.map((j) => j.line),
      ...(truncated.length ? [`truncated by the time budget: ${truncated.join(", ")}`] : []),
      ...(fresh.length ? [`new, not in the baseline: ${fresh.join(", ")}`] : []),
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

/** The baselines at `path`, a directory of one file per kind or one baseline file, by path, and
 *  whether it is a directory; or why there are none. */
async function readBaselines(
  path: string,
): Promise<{ directory: boolean; baselines: Map<string, Run> } | string> {
  let directory: boolean;
  try {
    directory = statSync(path).isDirectory();
  } catch {
    return `no baseline at ${path}`;
  }
  const paths = directory
    ? readdirSync(path)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => join(path, name))
    : [path];
  const baselines = new Map<string, Run>();
  for (const file of paths) {
    const baseline = await readBaseline(file, directory);
    if (typeof baseline === "string") return baseline;
    baselines.set(file, baseline);
  }
  return { directory, baselines };
}

/** The baseline in `file`, or why it is unusable: it is not JSON, or in a directory of kinds its
 *  name is not the one its CPU model derives, so that it would never be picked. */
async function readBaseline(file: string, directory: boolean): Promise<Run | string> {
  let baseline: Run;
  try {
    baseline = (await Bun.file(file).json()) as Run;
  } catch {
    return `the baseline ${file} is not JSON`;
  }
  const own = `${baselineName(baseline.cpu ?? "")}.json`;
  return directory && basename(file) !== own
    ? `the baseline ${file} names ${baseline.cpu ?? "no CPU model"}, whose file is ${own}`
    : baseline;
}

/** The kinds that have a baseline, as a refusal names them. */
function kinds(baselines: Map<string, Run>): string {
  const named = [...baselines.values()].map((b) => b.cpu ?? "a baseline naming no CPU model");
  return `kinds with a baseline: ${named.length ? named.join("; ") : "none"}`;
}

/** The baseline `run` is compared with, by its path: in a directory the file of the run's kind,
 *  picked by its name, or the one file given; or why there is none. compare() holds the CPU model
 *  the baseline records to the run's, so two models of one file name, or a lone file of another
 *  kind, are not compared. */
async function choose(run: Run, path: string): Promise<{ picked: string; baseline: Run } | string> {
  const read = await readBaselines(path);
  if (typeof read === "string") return read;
  const { directory, baselines } = read;
  if (!run.cpu) return `the runs name no CPU model; ${kinds(baselines)}`;
  const own = join(path, `${baselineName(run.cpu)}.json`);
  const picked = directory ? own : path;
  const baseline = baselines.get(picked);
  if (!baseline) {
    return (
      `no baseline of the kind ${run.cpu} in ${path}; ${kinds(baselines)}. ` +
      `A baseline of this kind is saved as ${own}`
    );
  }
  return { picked, baseline };
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
  const chosen = await choose(run, baselinePath);
  if (typeof chosen === "string") {
    say("error", `Not compared: ${chosen}.`);
    return 2;
  }
  const { picked, baseline } = chosen;
  const verdict = compare(run, baseline);
  console.log(`The median of ${runPaths.length} run(s) against ${picked}:`);
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
  const [baselines = "bench/baselines", ...runs] = Bun.argv.slice(2);
  process.exit(await main(baselines, runs.length ? runs : ["bench-results/latest.json"]));
}
