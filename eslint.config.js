// Lint for TypeScript (ADR-0008): typescript-eslint's recommended rules, the maintainability
// sensors `complexity` and `max-lines-per-function` as errors, and in Comb's library sources no
// DOM markup sink, so that no graph data is ever parsed as HTML (Q-5), and no eval, implied eval,
// or `new Function`, so that Comb runs under a policy without `unsafe-eval` (Q-6).
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const MARKUP = "parses a string as HTML: Comb draws graph data as text only (Q-5)";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "target/",
      "packages/comb/wasm/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      complexity: ["error", 10],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["packages/comb/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    // The browser's globals through which a string runs as code: no-implied-eval reports a call
    // only on a global it knows.
    languageOptions: {
      globals: {
        window: "readonly",
        self: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
      },
    },
    rules: {
      "no-restricted-properties": [
        "error",
        ...[
          "innerHTML",
          "outerHTML",
          "insertAdjacentHTML",
          "createContextualFragment",
          "setHTMLUnsafe",
          "parseHTMLUnsafe",
          "srcdoc",
        ].map((property) => ({ property, message: MARKUP })),
        ...["write", "writeln"].map((property) => ({
          object: "document",
          property,
          message: MARKUP,
        })),
        { object: "window", property: "DOMParser", message: MARKUP },
        { object: "globalThis", property: "DOMParser", message: MARKUP },
        { object: "self", property: "DOMParser", message: MARKUP },
      ],
      "no-restricted-globals": ["error", { name: "DOMParser", message: MARKUP }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
);
