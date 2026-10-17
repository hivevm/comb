// The PixiJS scene (ADR-0012): a `world` render group with its layers in drawing order, and an
// `overlay` in screen coordinates. This render reads the store and never writes it (ADR-0009).
//
// Pooling, culling by the engine's spatial index, the edge mesh, and the levels of detail of
// ADR-0012 are not built yet: every node has a view and all edges share one Graphics.
import { Application, BitmapText, Container, Graphics } from "pixi.js";
import type { Bridge } from "../bridge";
import type { EdgeData, GraphState, NodeView } from "../store";

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
const SELECTED_STROKE = 0x3b82f6;
const EDGE_COLOR = 0x9aa1ad;
const TEXT_COLOR = 0x1f2430;

/** One node: its box and its title. */
export class NodeGraphic extends Container {
  private readonly box = new Graphics();
  private readonly title = new BitmapText({
    text: "",
    style: { fontFamily: "Arial", fontSize: 14, fill: TEXT_COLOR },
  });

  constructor(readonly nodeId: string) {
    super();
    this.title.position.set(12, 10);
    this.addChild(this.box, this.title);
    this.eventMode = "static";
    this.cursor = "grab";
  }

  update(node: NodeView, selected: boolean): void {
    this.box
      .clear()
      .roundRect(0, 0, node.width, node.height, 6)
      .fill({ color: NODE_FILL })
      .stroke({ color: selected ? SELECTED_STROKE : NODE_STROKE, width: selected ? 2 : 1 });
    this.title.text = node.title;
  }
}

/** The nodes layer. */
export class NodesContainer extends Container {
  private readonly views = new Map<string, NodeGraphic>();

  /** Creates a view for every node and drops the views of nodes that are gone. */
  syncNodes(state: GraphState): void {
    for (const [id, view] of this.views) {
      if (!state.slots.has(id)) {
        view.destroy({ children: true });
        this.views.delete(id);
      }
    }
    for (const node of state.nodes) {
      let view = this.views.get(node.id);
      if (!view) {
        view = new NodeGraphic(node.id);
        this.views.set(node.id, view);
        this.addChild(view);
      }
      view.update(node, state.selection?.kind === "node" && state.selection.id === node.id);
    }
  }

  /** Places every view at its node's position in the engine's buffer. */
  syncPositions(state: GraphState, positions: Float32Array): void {
    for (const [id, view] of this.views) {
      const slot = state.slots.get(id);
      if (slot !== undefined) view.position.set(positions[slot * 2], positions[slot * 2 + 1]);
    }
  }
}

interface Anchors {
  source: { x: number; y: number };
  target: { x: number; y: number };
}

/** Where an edge leaves its source and enters its target: right and left middle. */
function anchors(edge: EdgeData, state: GraphState, positions: Float32Array): Anchors | null {
  const s = state.slots.get(edge.source);
  const t = state.slots.get(edge.target);
  const sn = s === undefined ? undefined : state.nodes[s];
  const tn = t === undefined ? undefined : state.nodes[t];
  if (s === undefined || t === undefined || !sn || !tn) return null;
  return {
    source: { x: positions[s * 2]! + sn.width, y: positions[s * 2 + 1]! + sn.height / 2 },
    target: { x: positions[t * 2]!, y: positions[t * 2 + 1]! + tn.height / 2 },
  };
}

/** The edges layer: every edge's path, computed by the engine, drawn into one Graphics. */
export class EdgesContainer extends Container {
  private readonly paths = new Graphics();

  constructor() {
    super();
    this.addChild(this.paths);
  }

  sync(state: GraphState, positions: Float32Array, bridge: Bridge): void {
    this.paths.clear();
    for (const edge of state.edges) {
      const at = anchors(edge, state, positions);
      if (!at) continue;
      const [x0, y0, x1, y1, x2, y2, x3, y3] = bridge.controlPoints(at.source, at.target);
      this.paths
        .moveTo(x0!, y0!)
        .bezierCurveTo(x1!, y1!, x2!, y2!, x3!, y3!)
        .stroke({ color: edge.color ?? EDGE_COLOR, width: 2 });
    }
  }
}

/** The edge-labels layer: a pill per label at its path parameter and label offset (G-6). */
export class LabelsContainer extends Container {
  sync(state: GraphState, positions: Float32Array, bridge: Bridge): void {
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    for (const edge of state.edges) {
      const at = edge.label && anchors(edge, state, positions);
      if (!edge.label || !at) continue;
      const point = bridge.labelPosition(at.source, at.target, edge.label.t, edge.label.offset);
      const text = new BitmapText({
        text: edge.label.text,
        style: { fontFamily: "Arial", fontSize: 12, fill: 0xffffff },
      });
      const pill = new Graphics()
        .roundRect(-text.width / 2 - 8, -11, text.width + 16, 22, 11)
        .fill({ color: edge.label.background ?? edge.color ?? EDGE_COLOR });
      text.position.set(-text.width / 2, -text.height / 2);
      const label = new Container({ children: [pill, text] });
      label.position.set(point.x, point.y);
      this.addChild(label);
    }
  }
}

/** The scene: layers in drawing order inside one render group that pans and zooms. */
export class Scene {
  readonly world = new Container({ isRenderGroup: true });
  readonly edges = new EdgesContainer();
  readonly nodes = new NodesContainer();
  readonly labels = new LabelsContainer();
  readonly overlay = new Container();

  constructor(readonly app: Application) {
    this.world.addChild(this.edges, this.nodes, this.labels);
    app.stage.addChild(this.world, this.overlay);
  }

  render(state: GraphState, bridge: Bridge): void {
    const positions = bridge.positions();
    this.nodes.syncNodes(state);
    this.nodes.syncPositions(state, positions);
    this.edges.sync(state, positions, bridge);
    this.labels.sync(state, positions, bridge);
    this.world.position.set(state.viewport.x, state.viewport.y);
    this.world.scale.set(state.viewport.scale);
  }
}
