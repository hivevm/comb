import { defineConfig, type Plugin, type PreviewServer } from "vite";

/** The Content Security Policy of Q-6: scripts, styles, and connections from the page's origin,
 *  WebAssembly compiled, and no `unsafe-eval`, inline script, or inline style. */
const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

/** Serves every response under the policy in test mode, so that every browser test runs under it
 *  (Q-6). */
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

// Port 5176 is the one the launch configuration "Example: UML" opens, beside the metric tree's
// 5173; the browser tests serve the example in test mode on a port free when their run begins
// (playwright.config.ts).
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [strictPolicy()] : [],
  // Node resolves `localhost` to ::1 alone, and the Dev Container's forwarding dials 127.0.0.1;
  // the example a developer runs listens there, the tests' server keeps Vite's default.
  server: { port: 5176, strictPort: true, host: mode === "test" ? undefined : "127.0.0.1" },
  preview: { port: 5176, strictPort: true, host: mode === "test" ? undefined : "127.0.0.1" },
}));
