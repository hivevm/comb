// What every gesture of the pointer is to the dispatcher in `index.ts`: how it moves, how it ends
// at a release or at a later press, and whether a change of the graph takes its subject from
// under it. Each gesture is a module of its own; this one holds what they share.
import type { Bridge, Hit } from "../bridge";
import type { GraphState, GraphStore } from "../store";
import { levelAt, toWorld } from "../store/viewport";

/** What a gesture works on: the store, the bridge to the engine, the world point a connection is
 *  dragged to, which the store does not hold (ADR-0029), and the one hit test, which the press,
 *  the hover, and the connection ask (ADR-0025). */
export interface Context {
  readonly store: GraphStore;
  readonly bridge: Bridge;
  readonly pointer: { x: number; y: number };
  /** What lies under the screen point `(x, y)`, connectors where the host lets the user
   *  connect. */
  readonly hitAt: (x: number, y: number) => Hit;
}

/** A gesture in progress, begun by a press. */
export interface Gesture {
  /** Whether the cursor shows a grab while it lasts. */
  readonly grabs: boolean;
  /** Follows the pointer to the screen point `(x, y)`. */
  move(x: number, y: number): void;
  /** Ends it, `released` where the pointer was released, not ended by a later press; tells
   *  what it changed (ADR-0030). */
  end(released: boolean): void;
  /** Whether the change `state` records took its subject from under it. */
  taken(state: GraphState): boolean;
  /** Ends it without a word, once its subject was taken. */
  drop(): void;
}

/** What a press at a screen point hits, from the engine's spatial index, at the level of detail
 *  of the viewport's scale, connectors where `connectors` asks for them (ADR-0025); nothing where
 *  the viewport puts the point beyond any finite world point, which the engine would refuse. */
export function targetAt(
  { store, bridge }: Pick<Context, "store" | "bridge">,
  x: number,
  y: number,
  connectors: boolean,
): Hit {
  const { viewport } = store.getState();
  const world = toWorld(viewport, x, y);
  if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return { kind: "none" };
  return bridge.hit(world.x, world.y, 1 / viewport.scale, levelAt(viewport.scale), connectors);
}
