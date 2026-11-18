// What every gesture of the pointer is to the dispatcher in `index.ts`: how it moves, how it ends
// at a release or at a later press, and whether a change of the graph takes its subject from
// under it. Each gesture is a module of its own; this one holds what they share.
import type { Bridge, ElementHit, Hit } from "../bridge";
import type { GraphState, GraphStore } from "../store";
import { levelAt, toWorld } from "../store/viewport";

/** How far, in screen pixels, the pointer moves after a press on an edge or a node before the
 *  press pans or drags: within it, the press stays a selection, and on a node a click
 *  (REN-node-content-in-rows). */
export const SLOP = 4;

/** A click on an element of a node's content, as the host application hears it
 *  (REN-node-content-in-rows): the
 *  node's identifier, the element's row, column, and kind, and an action's identifier. */
export type ContentClick = Readonly<{ node: string } & ElementHit>;

/** What a gesture works on: the store, the bridge to the engine, the world point a connection is
 *  dragged to, which the store does not hold (ARCH-graph-in-zustand-store), the one hit test,
 *  which the press, the hover, and the connection ask (REN-node-content-in-rows), and what a click
 *  and a drop hand to `api`. */
export interface Context {
  readonly store: GraphStore;
  readonly bridge: Bridge;
  readonly pointer: { x: number; y: number };
  /** What lies under the screen point `(x, y)`, connectors where the host lets the user
   *  connect. */
  readonly hitAt: (x: number, y: number) => Hit;
  /** Tells the host application of a click on an element of a node's content. */
  readonly click: (click: ContentClick) => void;
  /** Moves a dropped node into another container, or onto the canvas, after the host
   *  application's veto, and returns whether it moved (API-edits-report-nested-changes). */
  readonly moveInto: MoveInto;
}

/** A move of the user's of a node into a container, or onto the canvas for `null`, by
 *  identifiers, as `canMoveInto` is asked (API-edits-report-nested-changes). */
export interface ContainerMove {
  readonly node: string;
  readonly container: string | null;
}

/** Moves, by the user, the node `move` names into its container, or onto the canvas, where the
 *  host application's veto allows it, and returns whether it moved; an error the veto throws is
 *  thrown on, nothing moved (API-edits-report-nested-changes). `api` gives it. */
export type MoveInto = (move: ContainerMove) => boolean;

/** A gesture in progress, begun by a press. */
export interface Gesture {
  /** Whether the cursor shows a grab while it lasts. */
  readonly grabs: boolean;
  /** Follows the pointer to the screen point `(x, y)`. */
  move(x: number, y: number): void;
  /** Ends it, `released` where the pointer was released, not ended by a later press or a
   *  cancel, and `at` the screen point of a release on the canvas, none outside it; tells what it
   *  changed (API-edits-reported-as-typed-changes). */
  end(released: boolean, at?: { x: number; y: number }): void;
  /** Whether the change `state` records took its subject from under it. */
  taken(state: GraphState): boolean;
  /** Ends it without a word, once its subject was taken. */
  drop(): void;
}

/** What a press at a screen point hits, from the engine's spatial index, at the level of detail
 *  of the viewport's scale, connectors where `connectors` asks for them (REN-node-content-in-rows);
 *  nothing where
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
