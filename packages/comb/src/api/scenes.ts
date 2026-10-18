// The scene behind each Comb, for the testing entry; not part of the public interface.
import type { Scene } from "../render/scene";

export const scenes = new WeakMap<object, Scene>();
