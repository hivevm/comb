// The environment headless Chromium starts in, for the browser tests and the benchmark alike
// (ADR-0008). Headless Chromium starts its GPU process on the display server it finds; a display
// forwarded into the Dev Container (Wayland or X11) makes that fail, and PixiJS then falls back
// to its Canvas 2D renderer without a word. Without them, WebGL2 runs on SwiftShader. A run that
// opens a window keeps them, and so uses the machine's GPU.

/** The displays a headless Chromium must not see. */
const DISPLAYS = ["WAYLAND_DISPLAY", "DISPLAY"];

/** The environment to launch Chromium with: `env` without its displays, unless `windowed`. */
export function chromiumEnv(
  windowed: boolean,
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  if (windowed) return env;
  return Object.fromEntries(Object.entries(env).filter(([name]) => !DISPLAYS.includes(name)));
}
