// The testing entry, `comb/testing`: what the canvas draws, for tests, benchmarks, and tooling,
// and which of its layers it shows, for reference images.
// Its shape follows the scene and changes with it, outside the stable interface of `comb`.
import type { Comb } from "./api";
import { scenes } from "./api/scenes";
import { FAR_SCALE, NEAR_SCALE, type SceneSnapshot } from "./render/scene";

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
  const { world } = sceneOf(comb);
  return { x: world.x, y: world.y, scale: world.scale.x };
}

/** How many times the canvas of `comb` has rendered; cheap enough to read on every frame. */
export function renderCount(comb: Comb): number {
  return sceneOf(comb).renders;
}

/** Shows or hides layers of the canvas of `comb`, so that a reference image can hold one layer
 *  alone, without the text of the others, whose fonts differ between machines. */
export function showLayers(comb: Comb, layers: { nodes?: boolean; edgeLabels?: boolean }): void {
  const scene = sceneOf(comb);
  if (layers.nodes !== undefined) scene.nodes.visible = scene.particles.visible = layers.nodes;
  if (layers.edgeLabels !== undefined) scene.labels.visible = layers.edgeLabels;
}

/** The scales at which the levels of detail begin: near from `near`, middle from `far`, far
 *  below it; the benchmark measures at each. */
export function levelScales(): { near: number; far: number } {
  return { near: NEAR_SCALE, far: FAR_SCALE };
}
