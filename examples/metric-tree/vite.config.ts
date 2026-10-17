import { defineConfig } from "vite";

// Port 5173 is the one the Dev Container forwards and the launch configuration opens.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
