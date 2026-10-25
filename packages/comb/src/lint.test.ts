// The lint of the repository, eslint.config.js, run on snippets as if they were files of Comb's
// library sources, of its tests, and of the example.
import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../..", import.meta.url)) });

/** The rules that report `code` as the file at `filePath`, relative to the repository. */
async function reported(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((message) => message.ruleId ?? message.message);
}

const SINKS = [
  "export function f(e: Element, s: string) { e.innerHTML = s; }",
  "export function f(e: Element, s: string) { e.outerHTML = s; }",
  'export function f(e: Element, s: string) { e.insertAdjacentHTML("beforeend", s); }',
  "export function f(s: string) { document.write(s); }",
  "export function f(s: string) { document.writeln(s); }",
  'export function f(s: string) { return new DOMParser().parseFromString(s, "text/html"); }',
  'export function f(s: string) { return new window.DOMParser().parseFromString(s, "text/html"); }',
  "export function f(r: Range, s: string) { return r.createContextualFragment(s); }",
  "export function f(e: Element, s: string) { e.setHTMLUnsafe(s); }",
  "export function f(s: string) { return Document.parseHTMLUnsafe(s); }",
  "export function f(e: HTMLIFrameElement, s: string) { e.srcdoc = s; }",
  'export function f(s: string) { return new self.DOMParser().parseFromString(s, "text/html"); }',
];

describe("the DOM markup sinks", () => {
  // Verifies: Q-5
  test("are errors in Comb's library sources", async () => {
    for (const code of SINKS) {
      const rules = await reported(code, "packages/comb/src/render/labels.ts");
      expect({ code, rules }).toEqual({
        code,
        rules: [expect.stringMatching(/^no-restricted-(properties|globals)$/)],
      });
    }
  });

  test("are not reported in the tests or the example", async () => {
    for (const filePath of [
      "packages/comb/src/render/labels.test.ts",
      "examples/metric-tree/src/main.ts",
      "examples/metric-tree/e2e/example.spec.ts",
    ]) {
      for (const code of SINKS) {
        expect({ filePath, code, rules: await reported(code, filePath) }).toEqual({
          filePath,
          code,
          rules: [],
        });
      }
    }
  });

  test("leave text written as text alone", async () => {
    const code = "export function f(e: Element, s: string) { e.textContent = s; }";
    expect(await reported(code, "packages/comb/src/render/labels.ts")).toEqual([]);
  });
});

const EVALS: [string, string][] = [
  ["export function f(s: string) { return eval(s); }", "no-eval"],
  ["export function f(s: string) { return globalThis.eval(s); }", "no-eval"],
  ['export function f() { setTimeout("f()", 0); }', "no-implied-eval"],
  ['export function f() { setInterval("f()", 0); }', "no-implied-eval"],
  ['export function f() { window.setTimeout("f()", 0); }', "no-implied-eval"],
  ['export function f() { return new Function("a", "return a"); }', "no-new-func"],
  ['export function f() { return Function("return 1"); }', "no-new-func"],
];

describe("eval, implied eval, and new Function", () => {
  // Verifies: Q-6
  test("are errors in Comb's library sources", async () => {
    for (const [code, rule] of EVALS) {
      const rules = await reported(code, "packages/comb/src/bridge/index.ts");
      expect({ code, rules }).toEqual({ code, rules: [rule] });
    }
  });

  test("leave a function passed to a timer alone", async () => {
    const code = "export function f() { setTimeout(() => f(), 0); }";
    expect(await reported(code, "packages/comb/src/bridge/index.ts")).toEqual([]);
  });
});

// Decides no ADR clause and no criterion: a check of the kind AGENTS.md §5 asks for where a mistake
// could have been caught, a local that hid the shared `told` of the browser tests.
describe("a local that shadows an outer name", () => {
  const code = [
    'import { told } from "./shared";',
    "export function f() {",
    "  const told = [];",
    "  return told;",
    "}",
    "export const g = told;",
  ].join("\n");

  test("is an error in the library, its tests, the example, its browser tests, and the benchmark, naming its line", async () => {
    for (const filePath of [
      "packages/comb/src/interaction/pan.ts",
      "packages/comb/src/api/editors.test.ts",
      "examples/metric-tree/src/main.ts",
      "examples/metric-tree/e2e/remove.spec.ts",
      "bench/run.ts",
    ]) {
      const [result] = await eslint.lintText(code, { filePath });
      const found = result!.messages.map(({ ruleId, line }) => ({ ruleId, line }));
      expect({ filePath, found }).toEqual({
        filePath,
        found: [{ ruleId: "@typescript-eslint/no-shadow", line: 3 }],
      });
    }
  });
});
