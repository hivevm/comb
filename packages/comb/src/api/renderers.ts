// Which PixiJS renderers Comb draws with (ADR-0018): WebGL2, and Canvas 2D only where the host
// application opts in.

/** What Comb asks PixiJS for. By default WebGL2 first, so that without it PixiJS falls back to a
 *  renderer Comb then refuses by name; opted in, WebGL2 and then Canvas 2D alone, since PixiJS
 *  would otherwise try WebGPU between the two, which Comb does not draw with. */
export function preferenceFor(options: {
  allowCanvasFallback?: boolean;
}): "webgl" | ("webgl" | "canvas")[] {
  return options.allowCanvasFallback ? ["webgl", "canvas"] : "webgl";
}

/** Whether Comb draws with the PixiJS renderer named `renderer`. */
export function drawsWith(options: { allowCanvasFallback?: boolean }, renderer: string): boolean {
  return renderer === "webgl" || (!!options.allowCanvasFallback && renderer === "canvas");
}
