// The reference workload of the benchmark (ADR-0008): fixed work timed in the benchmark's page on
// the same runner, so that bench/compare.ts can tell a runner unlike the baseline's and refuse to
// compare its numbers. It uses what Comb's numbers depend on, the browser's JavaScript,
// WebAssembly, and WebGL2 raster, and none of Comb's code: a JavaScript loop, a WebAssembly loop,
// and a WebGL2 draw of a fixed mesh on a canvas of its own. Each part runs once to warm up and then
// ROUNDS times; the reference records each part's median and their sum.
//
// The parts are handed to page.evaluate, so each is serialized and uses nothing outside it but
// its argument and the timer the page is given first.
import type { Page } from "@playwright/test";

/** What the reference workload took, in milliseconds: its sum and each of its parts. */
export interface Reference {
  /** The sum of the parts, reported beside them; the runner gate judges the parts. */
  ms: number;
  js: number;
  wasm: number;
  gpu: number;
}

/** The parts of the reference by the name a log line and the gate report, and their key: the one
 *  list the gate, `usable`, the median, and the log line walk, so that a part added to the
 *  workload is taken everywhere. The sum comes first. */
export const PARTS = [
  ["sum", "ms"],
  ["JavaScript", "js"],
  ["WebAssembly", "wasm"],
  ["WebGL2", "gpu"],
] as const satisfies readonly (readonly [string, keyof Reference])[];

/** Every key of `Reference` among `PARTS`: the type checker refuses a part left out of the list. */
type Unlisted = Exclude<keyof Reference, (typeof PARTS)[number][1]>;
export const EVERY_PART_LISTED: [Unlisted] extends [never] ? true : never = true;

/** Odd, since the in-page timer takes the middle of its sorted times as their median, which
 *  `page.evaluate` keeps it from importing from bench/compare.ts. */
const ROUNDS = 5;
const LOOP = 100_000_000;

declare global {
  interface Window {
    referenceTimer: (work: () => number) => number;
  }
}

/** Gives the page `referenceTimer`: the median time of `rounds` runs of `work`, after one. */
function installTimer(rounds: number): void {
  window.referenceTimer = (work) => {
    const times: number[] = [];
    let sink = work();
    for (let round = 0; round < rounds; round++) {
      const start = performance.now();
      sink ^= work();
      times.push(performance.now() - start);
    }
    if (sink === 0.5) throw new Error("unreachable: keeps the work from being dropped");
    return times.sort((a, b) => a - b)[rounds >> 1]!;
  };
}

/** acc = acc * 31 + i over i < n, in 32 bits, in a thousand calls of one function, so that the
 *  engine optimizes that function as it would any hot one rather than the loop in flight. */
function jsPart(n: number): number {
  const steps = (acc: number, from: number, to: number) => {
    for (let i = from; i < to; i++) acc = (Math.imul(acc, 31) + i) | 0;
    return acc;
  };
  const chunk = Math.ceil(n / 1000);
  return window.referenceTimer(() => {
    let acc = 0;
    for (let from = 0; from < n; from += chunk) acc = steps(acc, from, Math.min(n, from + chunk));
    return acc;
  });
}

/** The loop of jsPart in WebAssembly, checked against it on its first thousand steps. */
function wasmPart(n: number): number {
  // prettier-ignore
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version 1
    0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f, // type: (i32) -> i32
    0x03, 0x02, 0x01, 0x00, // function 0 has type 0
    0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, // export "run" = function 0
    0x0a, 0x21, 0x01, 0x1f, 0x01, 0x02, 0x7f, // code: one body, locals acc and i
    0x03, 0x40, // loop
    0x20, 0x01, 0x41, 0x1f, 0x6c, 0x20, 0x02, 0x6a, 0x21, 0x01, // acc = acc * 31 + i
    0x20, 0x02, 0x41, 0x01, 0x6a, 0x22, 0x02, 0x20, 0x00, 0x49, 0x0d, 0x00, // while ++i < n
    0x0b, 0x20, 0x01, 0x0b, // end loop, return acc
  ]);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
  const run = instance.exports.run as (n: number) => number;
  let acc = 0;
  for (let i = 0; i < 1000; i++) acc = (Math.imul(acc, 31) + i) | 0;
  if (run(1000) !== acc) throw new Error("the WebAssembly loop disagrees with the JavaScript one");
  return window.referenceTimer(() => run(n));
}

const VERTEX = `#version 300 es
in vec2 at;
out vec2 uv;
void main() { uv = at; gl_Position = vec4(at * 2.0 - 1.0, 0.0, 1.0); }`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 colour;
void main() { colour = vec4(uv, 0.5 + 0.5 * sin(uv.x * 40.0 + uv.y * 30.0), 0.25); }`;

/** DRAWS blended draws of a grid of GRID x GRID cells, two triangles each, over a canvas of
 *  SIZE x SIZE pixels; reading a pixel back waits until every draw before it is rastered. */
function gpuPart(shaders: { vertex: string; fragment: string }): number {
  const [SIZE, GRID, DRAWS] = [1024, 64, 64];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new Error("the reference workload has no WebGL2; no number holds");
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, shaders.vertex],
    [gl.FRAGMENT_SHADER, shaders.fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader)!);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program)!);
  }
  const mesh: number[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const [x0, y0, x1, y1] = [x / GRID, y / GRID, (x + 1) / GRID, (y + 1) / GRID];
      mesh.push(x0, y0, x1, y0, x0, y1, x1, y0, x1, y1, x0, y1);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, "at");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  gl.viewport(0, 0, SIZE, SIZE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const pixel = new Uint8Array(4);
  const ms = window.referenceTimer(() => {
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let draw = 0; draw < DRAWS; draw++) gl.drawArrays(gl.TRIANGLES, 0, mesh.length / 2);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0]!;
  });
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return ms;
}

/** Times the reference workload in `page`. */
export async function referenceWorkload(page: Page): Promise<Reference> {
  await page.evaluate(installTimer, ROUNDS);
  const js = await page.evaluate(jsPart, LOOP);
  const wasm = await page.evaluate(wasmPart, LOOP);
  const gpu = await page.evaluate(gpuPart, { vertex: VERTEX, fragment: FRAGMENT });
  return { ms: js + wasm + gpu, js, wasm, gpu };
}
