// The scene behind each Comb, and the hit test its presses ask, for the testing entry; not part of
// the public interface.
import type { Hit } from "../bridge";
import type { Scene } from "../render/scene";

export const scenes = new WeakMap<object, Scene>();
/** What a press at a screen point of the canvas hits, as interaction answers it (ADR-0025). */
export const hitTests = new WeakMap<object, (x: number, y: number) => Hit>();
