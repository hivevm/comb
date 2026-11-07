// The options a benchmark run takes from its environment (ADR-0028, ADR-0029, ADR-0033).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { browserFor, cpuThrottleFor, graphFor } from "./options";

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

test("BENCH_GRAPH names the graph the run measures, the metric tree without it, and refuses another", () => {
  // Verifies: ADR-0033
  expect(graphFor({})).toBe("metric-tree");
  expect(graphFor({ BENCH_GRAPH: "" })).toBe("metric-tree");
  expect(graphFor({ BENCH_GRAPH: "metric-tree" })).toBe("metric-tree");
  expect(graphFor({ BENCH_GRAPH: "shaped" })).toBe("shaped");
  for (const value of ["Shaped", "uml", "shaped ", "metric"])
    expect(() => graphFor({ BENCH_GRAPH: value })).toThrow("BENCH_GRAPH");
});

test("the default graph is named in bench/options.ts alone, of the benchmark's sources", () => {
  // Verifies: ADR-0033
  const naming = readdirSync(import.meta.dir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => readFileSync(join(import.meta.dir, file), "utf8").includes('"metric-tree"'));
  expect(naming).toEqual(["options.ts"]);
});

/** The errors `tsc` reports in bench/run.ts, bench/options.ts read as `edit` changes it. */
function runErrors(edit: (options: string) => string): string[] {
  const root = join(import.meta.dir, "..");
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const optionsFile = join(import.meta.dir, "options.ts");
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, language, ...rest) =>
    file === optionsFile
      ? ts.createSourceFile(file, edit(readFileSync(file, "utf8")), language)
      : getSourceFile(file, language, ...rest);
  const run = join(import.meta.dir, "run.ts");
  const program = ts.createProgram([run], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(run))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

test("a graph added to GRAPHS alone fails the type checker, naming it and the example's GraphName", () => {
  // Verifies: ADR-0033
  expect(runErrors((options) => options)).toEqual([]);
  const added = (options: string) => {
    const edited = options.replace('"shaped"] as const', '"shaped", "added"] as const');
    expect(edited).not.toBe(options);
    return edited;
  };
  expect(runErrors(added)).toContainEqual(expect.stringMatching(/"added".*GraphName/s));
}, 60_000);
