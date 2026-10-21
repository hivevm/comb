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

// Port 5173 is the one the Dev Container forwards and the launch configuration opens. The browser
// tests serve the example in test mode on 5174 and its build on 5175 (playwright.config.ts), both
// under the policy.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [strictPolicy()] : [],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
}));
