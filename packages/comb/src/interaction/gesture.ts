// What every gesture of the pointer is to the dispatcher in `index.ts`: how it moves, how it ends
// at a release or at a later press, and whether a change of the graph takes its subject from
// under it. Each gesture is a module of its own; this one holds what they share.
import type { Bridge, Hit } from "../bridge";
import type { GraphState, GraphStore } from "../store";
import { levelAt, toWorld } from "../viewport";

/** What a gesture works on: the store, and the bridge to the engine. */
export interface Context {
  readonly store: GraphStore;
  readonly bridge: Bridge;
}

/** A gesture in progress, begun by a press. */
export interface Gesture {
  /** Whether the cursor shows a grab while it lasts. */
  readonly grabs: boolean;
  /** Follows the pointer to the screen point `(x, y)`. */
  move(x: number, y: number): void;
  /** Ends it, `released` where the pointer was released, not ended by a later press; tells
   *  what it changed (ADR-0023). */
  end(released: boolean): void;
  /** Whether the change `state` records took its subject from under it. */
  taken(state: GraphState): boolean;
  /** Ends it without a word, once its subject was taken. */
  drop(): void;
}

/** What a press at a screen point hits, from the engine's spatial index, at the level of detail
 *  of the viewport's scale, connectors where `connectors` asks for them (ADR-0025). */
export function targetAt(
  { store, bridge }: Context,
  x: number,
  y: number,
  connectors: boolean,
): Hit {
  const { viewport } = store.getState();
  const world = toWorld(viewport, x, y);
  return bridge.hit(world.x, world.y, 1 / viewport.scale, levelAt(viewport.scale), connectors);
}
