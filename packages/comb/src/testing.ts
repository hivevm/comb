// The testing entry, `comb/testing`: what the canvas draws, for tests, benchmarks, and tooling,
// which of its layers it shows, for reference images, and the transform between world and screen.
// Its shape follows the scene and changes with it, outside the stable interface of `comb`.
import type { Buffer, Matrix, WebGLRenderer } from "pixi.js";
import type { Comb } from "./api";
import { hitTests, scenes } from "./api/scenes";
import { TEST_MODE, trapNextCall, type Hit, type Rect } from "./bridge";
import { EdgesContainer } from "./render/edges";
import { LABEL_REACH } from "./render/labels";
import { CULLING_MARGIN, RESCALE, type SceneSnapshot } from "./render/scene";
import { FAR_SCALE, NEAR_SCALE, toScreen, worldRect } from "./viewport";

export type { SceneSnapshot };

function sceneOf(comb: Comb) {
  const scene = scenes.get(comb);
  if (!scene) throw new Error("comb/testing: not a Comb created by createComb");
  return scene;
}

/** What the canvas of `comb` draws right now, in world coordinates. */
export function inspect(comb: Comb): SceneSnapshot {
  return sceneOf(comb).inspect();
}

/** The viewport the canvas of `comb` draws with; cheap enough to read on every frame. */
export function viewport(comb: Comb): SceneSnapshot["viewport"] {
  return sceneOf(comb).drawnViewport();
}

/** The screen point, relative to the canvas, at which the canvas of `comb` shows world point
 *  (x, y): the transform interaction and the scene use, for tests and the benchmark. */
export function screenPoint(comb: Comb, x: number, y: number): { x: number; y: number } {
  return toScreen(viewport(comb), x, y);
}

/** Whether the canvas of `comb` drew the node or the edge of `id` at its last render; cheap
 *  enough to ask on every frame, as `inspect` is not at 50,000 nodes. */
export function isDrawn(comb: Comb, what: { node: string } | { edge: string }): boolean {
  return sceneOf(comb).draws(what);
}

/** What a press at the screen point `(x, y)`, relative to the canvas of `comb`, hits now: a
 *  connector where `comb` lets the user connect, a label, a node, an edge, or nothing. It asks the
 *  hit test a press asks, from the viewport a press reads, which is the drawn one once
 *  `whenRendered` resolves (ADR-0025). */
export function hitKind(comb: Comb, x: number, y: number): Hit["kind"] {
  const hitAt = hitTests.get(comb);
  if (!hitAt) throw new Error("comb/testing: not a Comb created by createComb");
  return hitAt(x, y).kind;
}

/** The world rectangle the canvas of `comb` shows, grown by `margin` screen pixels. */
export function visibleRect(comb: Comb, margin = 0): Rect {
  const { screen } = sceneOf(comb).app;
  return worldRect(viewport(comb), screen.width, screen.height, margin);
}

/** How many times the canvas of `comb` has rendered; cheap enough to read on every frame. */
export function renderCount(comb: Comb): number {
  return sceneOf(comb).renders;
}

/** What the canvas of `comb` has done. The GPU numbers count from the first call of `work` for
 *  that canvas, since they are counted by wrapping its WebGL context then; the views count from
 *  its first render, since the pools count them. A test reads `work` twice and compares.
 *
 *  The GPU numbers are counted at the WebGL context, so that they hold whatever PixiJS does: GPU
 *  buffers created, buffer storage allocated (a buffer created or grown), bytes uploaded into
 *  buffers, of them the bytes of the edge mesh, and texture uploads. A resize is a buffer of the
 *  edge mesh given data of another length, which PixiJS reports so that a renderer replaces the
 *  GPU buffer. */
export interface Work {
  buffersCreated: number;
  bufferAllocations: number;
  bufferResizes: number;
  bytesUploaded: number;
  meshBytesUploaded: number;
  textureUploads: number;
  viewsCreated: number;
}

/** `work` was asked of a canvas that draws without WebGL, where it counts nothing: it refuses
 *  rather than report counts it did not take. */
export class UncountedRendererError extends Error {
  override name = "UncountedRendererError";
  constructor(readonly renderer: string) {
    super(`comb/testing: work counts WebGL calls, and this canvas draws with ${renderer}`);
  }
}

type Counts = Omit<Work, "viewsCreated">;

const counted = new WeakMap<Comb, Counts>();

/** The bytes a `bufferData` or `bufferSubData` call uploads from `data`: from element `offset`,
 *  `length` elements, or to its end where `length` is 0 or missing; none for a size alone. */
function bytesOf(data: unknown, offset = 0, length = 0): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (!ArrayBuffer.isView(data)) return 0;
  const element = "BYTES_PER_ELEMENT" in data ? (data.BYTES_PER_ELEMENT as number) : 1;
  return length > 0 ? length * element : data.byteLength - offset * element;
}

/** Counts the calls of `renderer`'s WebGL context into `counts`, from now on; uploads while
 *  PixiJS updates one of `mesh` count as the mesh's too. Both buffer upload calls take the offset
 *  and the length of their data, in elements, fourth and fifth. */
function countCalls(renderer: WebGLRenderer, mesh: Set<Buffer>, counts: Counts): void {
  const { gl } = renderer;
  const system = renderer.buffer;
  const { createBuffer, bufferData, bufferSubData } = gl;
  const { updateBuffer } = system;
  let updating: Buffer | null = null;
  const uploaded = (bytes: number) => {
    counts.bytesUploaded += bytes;
    if (updating && mesh.has(updating)) counts.meshBytesUploaded += bytes;
  };
  type Args = [unknown, unknown, unknown, number?, number?];
  system.updateBuffer = function (this: typeof system, buffer: Buffer) {
    updating = buffer;
    try {
      return updateBuffer.call(this, buffer);
    } finally {
      updating = null;
    }
  };
  gl.createBuffer = function (this: WebGL2RenderingContext) {
    counts.buffersCreated += 1;
    return createBuffer.call(this);
  };
  gl.bufferData = function (this: WebGL2RenderingContext, ...args: Args) {
    counts.bufferAllocations += 1;
    uploaded(bytesOf(args[1], args[3], args[4]));
    return Reflect.apply(bufferData, this, args);
  } as typeof bufferData;
  gl.bufferSubData = function (this: WebGL2RenderingContext, ...args: Args) {
    uploaded(bytesOf(args[2], args[3], args[4]));
    return Reflect.apply(bufferSubData, this, args);
  } as typeof bufferSubData;
  for (const name of [
    "texImage2D",
    "texSubImage2D",
    "texImage3D",
    "texSubImage3D",
    "compressedTexImage2D",
    "compressedTexSubImage2D",
  ] as const) {
    const upload = gl[name] as (...args: unknown[]) => void;
    (gl as unknown as Record<string, unknown>)[name] = function (
      this: WebGL2RenderingContext,
      ...args: unknown[]
    ) {
      counts.textureUploads += 1;
      return Reflect.apply(upload, this, args);
    };
  }
}

/** What the canvas of `comb` has done so far; see `Work`. Throws `UncountedRendererError` where
 *  it draws without WebGL. */
export function work(comb: Comb): Work {
  const scene = sceneOf(comb);
  let counts = counted.get(comb);
  if (!counts) {
    const { renderer } = scene.app;
    const { edges } = scene;
    if (renderer.name !== "webgl" || !(edges instanceof EdgesContainer)) {
      throw new UncountedRendererError(renderer.name);
    }
    const fresh: Counts = {
      buffersCreated: 0,
      bufferAllocations: 0,
      bufferResizes: 0,
      bytesUploaded: 0,
      meshBytesUploaded: 0,
      textureUploads: 0,
    };
    const { attributes, indexBuffer } = edges.geometry;
    const mesh = new Set([...Object.values(attributes).map((a) => a.buffer), indexBuffer]);
    countCalls(renderer as WebGLRenderer, mesh, fresh);
    for (const buffer of mesh) buffer.on("change", () => (fresh.bufferResizes += 1));
    counted.set(comb, (counts = fresh));
  }
  const viewsCreated = scene.nodes.created + scene.labels.created + scene.particles.created;
  return { ...counts, viewsCreated };
}

/** The screen point, relative to the canvas, of every vertex the edge mesh of `comb` draws, `x, y`
 *  each, as its shader computes it: in `f32`, from the positions PixiJS uploads and the two
 *  transforms it hands the shader as `f32` uniforms, the world's and the mesh's within the world
 *  (ADR-0010). The shader multiplies the projection into clip space first, a scale and a shift
 *  by the canvas's size, which rounds by about 2^-24 of the canvas's size more; it is left out,
 *  since that cannot move a vertex by a quarter pixel. WebGL only: the Canvas 2D fallback has no such mesh. */
export function edgeVertices(comb: Comb): Float64Array {
  const { app, edges, world } = sceneOf(comb);
  if (!(edges instanceof EdgesContainer)) {
    throw new Error(`comb/testing: edgeVertices reads the WebGL mesh, not ${app.renderer.name}`);
  }
  const f = Math.fround;
  const sum = (...terms: number[]) => terms.reduce((total, term) => f(total + term));
  const uniform = (m: Matrix) => [m.a, m.b, m.c, m.d, m.tx, m.ty].map(f) as Six;
  const [wa, wb, wc, wd, wx, wy] = uniform(world.worldTransform);
  const [ta, tb, tc, td, tx, ty] = uniform(edges.mesh.groupTransform);
  // The shader's product of the world's matrix and the mesh's, each entry rounded as f32 is.
  const a = sum(f(wa * ta), f(wc * tb));
  const b = sum(f(wb * ta), f(wd * tb));
  const c = sum(f(wa * tc), f(wc * td));
  const d = sum(f(wb * tc), f(wd * td));
  const x = sum(f(wa * tx), f(wc * ty), wx);
  const y = sum(f(wb * tx), f(wd * ty), wy);
  const positions = edges.geometry.getAttribute("aPosition").buffer.data as Float32Array;
  const out = new Float64Array(edges.size().vertices * 2);
  for (let i = 0; i < out.length; i += 2) {
    const [px, py] = [positions[i]!, positions[i + 1]!];
    out[i] = sum(f(a * px), f(c * py), x);
    out[i + 1] = sum(f(b * px), f(d * py), y);
  }
  return out;
}

type Six = [number, number, number, number, number, number];

/** Shows or hides layers of the canvas of `comb`, so that a reference image can hold one layer
 *  alone, without the text of the others, whose fonts differ between machines. */
export function showLayers(comb: Comb, layers: { nodes?: boolean; edgeLabels?: boolean }): void {
  const scene = sceneOf(comb);
  if (layers.nodes !== undefined) scene.nodes.visible = scene.particles.visible = layers.nodes;
  if (layers.edgeLabels !== undefined) scene.labels.visible = layers.edgeLabels;
}

/** The numbers the scene draws by, so that a test or the benchmark reads them instead of
 *  repeating them: the scales at which the levels of detail begin, near from `near`, middle from
 *  `far`, far below it; the culling margin in screen pixels; the least reach of an edge label's
 *  pill in world units; and how far the scale may move before the scene queries again. */
export function sceneNumbers(): {
  near: number;
  far: number;
  cullingMargin: number;
  labelReach: number;
  rescale: number;
} {
  return {
    near: NEAR_SCALE,
    far: FAR_SCALE,
    cullingMargin: CULLING_MARGIN,
    labelReach: LABEL_REACH,
    rescale: RESCALE,
  };
}

/** Whether the bridge runs in test mode, in which every view kept across an engine call reads
 *  empty (ADR-0010): what the browser tests assert before they trust that a stale view fails. */
export function testMode(): boolean {
  return TEST_MODE;
}

/** Test mode only: the next call of the engine traps, as a trap that slipped past the bridge's
 *  checks would, so that a test sees the engine lost for the page (ADR-0021). Throws outside test
 *  mode, and where the engine was built without its trap. */
export { trapNextCall };
