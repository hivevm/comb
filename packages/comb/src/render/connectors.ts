// The connectors layer and the connection being dragged (ADR-0024, ADR-0027): the four connectors
// of the node under the pointer, and while the user drags a connection those of its source and of
// the node under the pointer, the compatible ones drawn apart; and in the overlay, a line from the
// source's connector to the pointer. It reads the store and the engine's positions, and writes
// neither (ADR-0028).
import { Graphics } from "pixi.js";
import type { GraphView, Side } from "../store";
import { toScreen } from "../store/viewport";

const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
/** The radius of a drawn connector, in screen pixels. */
const RADIUS = 5;
const PLAIN = 0x5a6170;
const COMPATIBLE = 0x22a55b;
const LINE = 0x2060e0;

/** A connector as the layer draws it, for inspection. */
export interface DrawnConnector {
  node: string;
  side: Side;
  compatible: boolean;
}

/** The world point of the connector of `side` of the node at `x, y` of size `width × height`. */
export function connectorPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  side: Side,
): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: x + width / 2, y };
    case "right":
      return { x: x + width, y: y + height / 2 };
    case "bottom":
      return { x: x + width / 2, y: y + height };
    case "left":
      return { x, y: y + height / 2 };
  }
}

/** Where a drawn connector's circle is centred, in world units, for inspection. */
export interface DrawnConnectorPoint {
  node: string;
  side: Side;
  x: number;
  y: number;
}

/** The connectors of the nodes the pointer shows, in world units less the query's origin, as the
 *  edges and labels are placed, so that the GPU sees no far coordinate. */
export class ConnectorsLayer extends Graphics {
  drawn: DrawnConnector[] = [];
  /** The centre of each drawn connector, in the order of `drawn`. */
  points: DrawnConnectorPoint[] = [];
  /** What the layer last drew from, so that a render that changes none of it draws nothing anew:
   *  a change of the layer's geometry would have its render group build its instructions again. */
  private from: unknown[] = [];
  private drawnScale = Number.NaN;

  /** Draws the connectors `state` asks for, none at the far level, where anything they are drawn
   *  from changed since the last render. */
  sync(
    state: GraphView,
    positions: Float32Array,
    origin: { x: number; y: number },
    far: boolean,
  ): void {
    const { viewport } = state;
    const from = drawnFrom(state, origin, far);
    if (
      from.every((value, i) => Object.is(value, this.from[i])) &&
      viewport.scale === this.drawnScale
    )
      return;
    [this.from, this.drawnScale] = [from, viewport.scale];
    const shown = far ? [] : shownBy(state);
    if (shown.length === 0 && this.drawn.length === 0) return;
    this.clear();
    this.drawn = [];
    this.points = [];
    for (const [slot, compatible] of shown)
      this.drawNode(state, positions, origin, slot, compatible);
  }

  /** Draws the four connectors of the node in `slot`. */
  private drawNode(
    state: GraphView,
    positions: Float32Array,
    origin: { x: number; y: number },
    slot: number,
    compatible: boolean,
  ): void {
    const node = state.nodes[slot];
    if (!node) return;
    const [x, y] = [positions[slot * 2]!, positions[slot * 2 + 1]!];
    for (const side of SIDES) {
      const at = connectorPoint(x, y, node.width, node.height, side);
      this.circle(at.x - origin.x, at.y - origin.y, RADIUS / state.viewport.scale).fill(
        compatible ? COMPATIBLE : PLAIN,
      );
      this.drawn.push({ node: node.id, side, compatible });
      this.points.push({ node: node.id, side, x: at.x, y: at.y });
    }
  }
}

/** What the drawn connectors depend on: not where the pointer drags a connection to. */
function drawnFrom(state: GraphView, origin: { x: number; y: number }, far: boolean): unknown[] {
  const { connection, hovered, nodes, positionsVersion } = state;
  const { source, side, over, compatible } = connection ?? {};
  return [
    far,
    source,
    side,
    over,
    compatible,
    hovered,
    nodes,
    positionsVersion,
    origin.x,
    origin.y,
  ];
}

/** The nodes whose connectors `state` shows, each with whether they are drawn compatible: while
 *  the user connects, the source and the node under the pointer, else the node under it. */
function shownBy(state: GraphView): [number, boolean][] {
  const { connection, hovered } = state;
  if (!connection) return hovered === null ? [] : [[hovered, false]];
  const over = connection.over;
  return over === null || over === connection.source
    ? [[connection.source, false]]
    : [
        [connection.source, false],
        [over, connection.compatible],
      ];
}

/** The connection being dragged, in the overlay's screen coordinates. */
export class ConnectionLine extends Graphics {
  drawn: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;

  sync(state: GraphView, positions: Float32Array): void {
    const { connection, viewport } = state;
    const node = connection ? state.nodes[connection.source] : undefined;
    if (!connection || !node) {
      if (this.drawn) this.clear();
      this.drawn = null;
      return;
    }
    this.clear();
    const slot = connection.source;
    const world = connectorPoint(
      positions[slot * 2]!,
      positions[slot * 2 + 1]!,
      node.width,
      node.height,
      connection.side,
    );
    const from = toScreen(viewport, world.x, world.y);
    const to = toScreen(viewport, connection.to.x, connection.to.y);
    this.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 2, color: LINE });
    this.drawn = { from: world, to: { ...connection.to } };
  }
}
