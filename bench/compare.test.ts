import { describe, expect, test } from "bun:test";
import { compare, MARGIN, median, type Run } from "./compare";

const SWIFTSHADER =
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)";

function run(firstFrameMs: number, p95: number, copies = 3334): Run {
  return {
    copies,
    gpu: SWIFTSHADER,
    load: { nodes: copies * 15, firstFrameMs },
    drag: { p95 },
    pan: { p95 },
    zoom: { p95 },
    levels: { near: { pan: { p95 } }, middle: { pan: { p95 } } },
  };
}

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
