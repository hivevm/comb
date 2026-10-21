// Where Comb installs PixiJS's code generation without eval (ADR-0020).
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCES = fileURLToPath(new URL("..", import.meta.url));

/** The modules each static import of `source` names, in order. */
function imports(source: string): string[] {
  return [...source.matchAll(/^import\s(?:[^;]*?\sfrom\s)?"([^"]+)";/gms)].map((m) => m[1]!);
}

test("the module that creates the renderer imports pixi.js/unsafe-eval before pixi.js", () => {
  // Verifies: ADR-0020
  const source = readFileSync(`${SOURCES}/api/index.ts`, "utf8");
  expect(source).toContain("new Application()");
  const named = imports(source);
  expect(named.indexOf("pixi.js/unsafe-eval")).toBe(0);
  expect(named.indexOf("pixi.js")).toBeGreaterThan(0);
});

test("no other module of Comb's library names it, in any form of import or export", () => {
  // Verifies: ADR-0020
  const naming = [...new Glob("**/*.ts").scanSync(SOURCES)]
    .filter((file) => !file.endsWith(".test.ts"))
    .filter((file) =>
      /["'`]pixi\.js\/unsafe-eval["'`]/.test(readFileSync(`${SOURCES}/${file}`, "utf8")),
    )
    .map((file) => file.replaceAll("\\", "/"));
  expect(naming).toEqual(["api/index.ts"]);
});
