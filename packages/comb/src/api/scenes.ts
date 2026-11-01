// What the testing entry reads behind each Comb: its scene, and the hit test its presses ask; not
// part of the public interface.
import type { Hit } from "../bridge";
import type { Scene } from "../render/scene";

export interface Inspected {
  readonly scene: Scene;
  /** What a press at a screen point of the canvas hits, as interaction answers it (ADR-0013). */
  readonly hitAt: (x: number, y: number) => Hit;
}

export const scenes = new WeakMap<object, Inspected>();
