import { defineConfig, type Plugin } from "vite";

/** The Content Security Policy of Q-6: scripts, styles, and connections from the page's origin,
 *  WebAssembly compiled, and no `unsafe-eval`, inline script, or inline style. */
const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

/** Serves every response under the policy, so that every browser test runs under it (Q-6). */
function strictPolicy(): Plugin {
  return {
    name: "strict-policy",
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader("Content-Security-Policy", POLICY);
        next();
      });
    },
  };
}

// Port 5173 is the one the Dev Container forwards and the launch configuration opens. The browser
// tests serve the example in test mode on 5174 (playwright.config.ts), under the policy.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [strictPolicy()] : [],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
}));
