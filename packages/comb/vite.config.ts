import { defineConfig } from "vite";

// The library bundle: Comb's JavaScript without PixiJS, which the host application bundles itself.
// The engine's WebAssembly is not in it; `comb` exports that file as `comb/engine.wasm` and the
// host application hands it over (ADR-0019). Q-3 measures the two together.
export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "comb" },
    rollupOptions: { external: [/^pixi\.js(\/.*)?$/] },
    emptyOutDir: true,
  },
});
