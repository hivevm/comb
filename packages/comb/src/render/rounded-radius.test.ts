// The shell draws a rounded rectangle's corners by the radius the engine hits them by: the two
// copies of `ROUNDED_RADIUS`, in the node views and in `crates/engine/src/shape.rs`, agree
// (ADR-0032).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** The number `pattern` captures in the file at `path`, relative to this one. */
function constant(path: string, pattern: RegExp): number {
  const match = readFileSync(new URL(path, import.meta.url), "utf8").match(pattern);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

test("a rounded rectangle's corners are drawn by the radius the engine hits them by", () => {
  // Verifies: ADR-0032
  const engine = constant(
    "../../../../crates/engine/src/shape.rs",
    /pub const ROUNDED_RADIUS: f64 = ([0-9.]+);/,
  );
  const shell = constant("./nodes.ts", /const ROUNDED_RADIUS = ([0-9.]+);/);
  expect({ shell }).toEqual({ shell: engine });
});
