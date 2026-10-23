import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type PreviewServer } from "vite";

/** The Content Security Policy of Q-6: scripts, styles, and connections from the page's origin,
 *  WebAssembly compiled, and no `unsafe-eval`, inline script, or inline style. */
const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

/** Serves every response under the policy, from the development server and from `vite preview`,
 *  which serves the built example, so that every browser test runs under it (Q-6). */
function strictPolicy(): Plugin {
  const underPolicy = ({ middlewares }: Pick<PreviewServer, "middlewares">) => {
    middlewares.use((_request, response, next) => {
      response.setHeader("Content-Security-Policy", POLICY);
      next();
    });
  };
  return {
    name: "strict-policy",
    configureServer: underPolicy,
    configurePreviewServer: underPolicy,
  };
}

/** In test mode the example hands Comb the engine built with the bridge crate's feature
 *  `test-mode`, which traps on demand (ADR-0021); its glue is the same as the production engine's.
 *  The build, which the tests tagged @built and the benchmark run, keeps the production engine. */
const TEST_ENGINE = {
  find: /^comb\/engine\.wasm(?=\?|$)/,
  replacement: fileURLToPath(
    new URL("../../packages/comb/wasm/test-mode/engine_bg.wasm", import.meta.url),
  ),
};

// Port 5173 is the one the Dev Container forwards and the launch configuration opens. The browser
// tests serve the example in test mode on 5174 and its build on 5175 (playwright.config.ts), both
// under the policy.
export default defineConfig(({ command, mode }) => ({
  plugins: mode === "test" ? [strictPolicy()] : [],
  resolve: { alias: command === "serve" && mode === "test" ? [TEST_ENGINE] : [] },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
}));
