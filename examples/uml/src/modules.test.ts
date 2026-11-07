// The modules of the UML example: no diagram's file imports another diagram's, since what the
// diagrams share stands in a module of its own, which imports none of them, and the lookup of an
// element of the page is written once. Read from the sources, as the structural test of ADR-0030
// reads the imports.
// Verifies: G-12
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = import.meta.dir;
const DIAGRAMS = ["class-diagram", "package-diagram", "state-diagram"];

/** The modules `file` imports by a relative specifier, each without its "./" and extension. */
function importsOf(file: string): string[] {
  const source = readFileSync(join(SRC, file), "utf8");
  return [...source.matchAll(/\bfrom\s+"\.\/([^"]+)"/g)].map(([, name]) =>
    name!.replace(/\.ts$/, ""),
  );
}

for (const diagram of DIAGRAMS)
  test(`${diagram}.ts imports no other diagram's file`, () => {
    const others = DIAGRAMS.filter((each) => each !== diagram);
    expect(importsOf(`${diagram}.ts`).filter((name) => others.includes(name))).toEqual([]);
  });

test("shared.ts, what the diagrams share, imports no diagram's file", () => {
  expect(importsOf("shared.ts").filter((name) => DIAGRAMS.includes(name))).toEqual([]);
});

test("the lookup of an element of the page is written once", () => {
  const defining = readdirSync(SRC)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => /\bfunction element\b/.test(readFileSync(join(SRC, file), "utf8")));
  expect(defining).toHaveLength(1);
});

test("rules.ts defines no kind of node, and imports them from shared.ts", () => {
  const source = readFileSync(join(SRC, "rules.ts"), "utf8");
  expect(source).not.toMatch(/\b(CLASSIFIER|STATE|NODE)_KINDS\s*=/);
  expect(source).not.toMatch(/\btype\s+(Classifier|State|Node)Kind\s*=/);
  expect(importsOf("rules.ts")).toContain("shared");
});
