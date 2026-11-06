// The Benchmark workflow's gate (ADR-0033): each comparison step's script, run with a stand-in for
// `bun` that exits as bench/compare.ts would, fails the job or not. The metric tree's comparison
// fails on every refusal and regression; the shaped graph's fails on those too, but where its kind
// has no baseline (exit 3) it reports the median and the file its baseline would be saved as, and
// passes.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Step {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}
const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dir, "../.github/workflows/benchmark.yml"), "utf8"),
) as { jobs: { bench: { steps: Step[] } } };

/** The script of the comparison step whose command compares the runs `runs`. */
function compareStep(runs: string): string {
  const steps = workflow.jobs.bench.steps.filter(
    (step) => step.run?.includes("bench/compare.ts") && step.run.includes(runs),
  );
  expect(steps).toHaveLength(1);
  return steps[0]!.run!;
}

/** Runs `script` in a directory of its own, `bun` exiting with `code` after printing what
 *  bench/compare.ts prints of a missing baseline; its exit status and output. */
function runStep(script: string, code: number) {
  const dir = mkdtempSync(join(tmpdir(), "workflow-"));
  try {
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "bench-results"));
    writeFileSync(join(dir, "bench-results", "median.shaped.json"), '{ "graph": "shaped" }\n');
    const bun = join(dir, "bin", "bun");
    writeFileSync(
      bun,
      `#!/bin/sh\necho "Not compared: no baseline ... saved as bench/baselines/k.shaped.json." >&2\nexit ${code}\n`,
    );
    chmodSync(bun, 0o755);
    const summary = join(dir, "summary.md");
    writeFileSync(summary, "");
    const done = Bun.spawnSync(["bash", "-e", "-c", script], {
      cwd: dir,
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary },
    });
    return {
      status: done.exitCode,
      out: done.stdout.toString() + done.stderr.toString(),
      summary: readFileSync(summary, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the metric tree's comparison fails the job on every exit but 0", () => {
  // Verifies: ADR-0033
  const script = compareStep("run-*.json");
  for (const code of [1, 2, 3]) expect(runStep(script, code).status).not.toBe(0);
  expect(runStep(script, 0).status).toBe(0);
});

test("the shaped graph's comparison passes without a baseline on its kind, reporting the median", () => {
  // Verifies: ADR-0033
  const script = compareStep("shaped-*.json");
  for (const code of [1, 2]) expect(runStep(script, code).status).toBe(code);
  expect(runStep(script, 0).status).toBe(0);
  const missing = runStep(script, 3);
  expect(missing.status).toBe(0);
  expect(missing.out).toContain("::notice::");
  expect(missing.out).toContain("saved as bench/baselines/k.shaped.json");
  expect(missing.summary).toContain('"graph": "shaped"');
});

test("the metric tree is compared before the shaped graph runs, which cannot skip it", () => {
  // Verifies: ADR-0033
  const steps = workflow.jobs.bench.steps;
  const compared = steps.findIndex((step) => step.run?.includes("run-*.json"));
  const shaped = steps.findIndex((step) => step.env?.BENCH_GRAPH === "shaped");
  expect(compared).toBeGreaterThan(-1);
  expect(shaped).toBeGreaterThan(compared);
  for (const step of steps.slice(shaped)) expect(step.if).toBe("${{ !cancelled() }}");
});
