import { defineConfig } from "vite";

// The library bundle Q-3 measures: Comb's JavaScript and its WebAssembly, without PixiJS, which
// the host application bundles itself.
export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "comb" },
    rollupOptions: { external: [/^pixi\.js(\/.*)?$/] },
    emptyOutDir: true,
  },
});
