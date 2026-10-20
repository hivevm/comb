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
