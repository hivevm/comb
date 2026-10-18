// The PixiJS scene (ADR-0012): a `world` render group with its layers in drawing order, and an
// `overlay` in screen coordinates. This render reads the store and never writes it (ADR-0009).
//
// After every change, the scene asks the engine which nodes, edges, and edge labels meet the
// viewport and a margin around it, and binds pooled node views and edge-label views to exactly
// those; the found edges are drawn as one mesh. The zoom chooses one of three levels of detail:
// near draws node boxes, titles, and edge labels; middle draws node boxes and titles; far draws
// nodes as particles and edges as thin lines, without text.
import { Application, BitmapText, Container } from "pixi.js";
import type { Bridge, Rect } from "../bridge";
import { worldRect } from "../interaction/viewport";
import type { GraphView } from "../store";
import { EdgesContainer } from "./edges";
import { LabelsContainer } from "./labels";
import { NodeGraphic, NodesContainer } from "./nodes";
import { NodeParticles } from "./particles";

/** How far a drawn edge may stray from its path, in screen pixels: half the 0.5 px of Q-4. */
export const FLATNESS = 0.25;

/** The level of detail the scene draws at (ADR-0012). */
export type Level = "near" | "middle" | "far";
/** The scale from which the scene draws near: edge labels, 12 px, are 7 px tall there, the least
 *  that still reads. */
export const NEAR_SCALE = 0.6;
/** The scale below which the scene draws far: titles, 14 px, are under 4 px tall there and no
 *  longer read, so nodes become particles. */
export const FAR_SCALE = 0.3;

/** The level of detail at `scale`. */
export function levelAt(scale: number): Level {
  if (scale >= NEAR_SCALE) return "near";
  return scale >= FAR_SCALE ? "middle" : "far";
}

/** The width of an edge at the far level, in screen pixels. */
const FAR_EDGE_WIDTH = 1;
/** The width of an edge at the other levels, in world units. */
const EDGE_WIDTH = 2;
const NONE = new Uint32Array(0);
/** How far beyond the viewport the scene binds display objects, in screen pixels, so that a
 *  small pan finds them bound: at least this far when it queries, and at most twice as far while
 *  it moves the world alone between queries. */
export const CULLING_MARGIN = 128;

/** What the scene draws at one moment, in world coordinates, for tests and tooling. Its shape
 *  follows the scene and changes with it; it is not part of the stable interface. */
export interface SceneSnapshot {
  /** The PixiJS renderer that draws: `"webgl"` where WebGL2 is available. */
  renderer: string;
  viewport: { x: number; y: number; scale: number };
  /** The level of detail the scene draws at. */
  level: Level;
  /** Every node drawn, by a view or, at the far level, as a particle. */
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  /** How many nodes are drawn as particles. */
  particles: number;
  /** How many text objects are bound. */
  texts: number;
  /** The node drawn as selected, if one is drawn. */
  highlighted: string | null;
  edges: { id: string; source: { x: number; y: number }; target: { x: number; y: number } }[];
  edgeLabels: { edge: string; x: number; y: number }[];
  /** How many triangles the edge mesh draws. */
  edgeTriangles: number;
  /** Every display object under the world, the layers themselves included. */
  displayObjects: number;
  /** How many times the scene has rendered. */
  renders: number;
  /** How many of the renders queried the engine; the others moved the world alone. */
  queries: number;
}

function countDisplayObjects(container: Container): number {
  return container.children.reduce((sum, child) => sum + countDisplayObjects(child), 1);
}

function countTexts(container: Container): number {
  const own = container instanceof BitmapText ? 1 : 0;
  return container.children.reduce((sum, child) => sum + countTexts(child), own);
}

/** How far the scale may move from the one the scene last queried at before it queries again:
 *  a mesh flattened within a quarter pixel then strays at most 0.31 px, within Q-4. */
const RESCALE = 1.25;

/** What the scene last queried for: the graph state and the world rectangle it covers. */
interface Drawn {
  rect: Rect;
  scale: number;
  level: Level;
  nodes: GraphView["nodes"];
  edges: GraphView["edges"];
  selection: GraphView["selection"];
  positionsVersion: number;
}

const within = (inner: Rect, outer: Rect) =>
  outer.minX <= inner.minX &&
  inner.maxX <= outer.maxX &&
  outer.minY <= inner.minY &&
  inner.maxY <= outer.maxY;

/** The scene: layers in drawing order inside one render group that pans and zooms. */
export class Scene {
  /** How many times the scene has rendered; cheap to read on every frame. */
  renders = 0;
  readonly world = new Container({ isRenderGroup: true });
  readonly edges = new EdgesContainer();
  readonly particles = new NodeParticles();
  readonly nodes = new NodesContainer();
  readonly labels = new LabelsContainer();
  readonly overlay = new Container();
  level: Level = "near";
  /** How many renders queried the engine; the others moved the world alone. */
  queries = 0;
  private drawn: Drawn | null = null;

  constructor(readonly app: Application) {
    this.world.addChild(this.edges, this.particles, this.nodes, this.labels);
    app.stage.addChild(this.world, this.overlay);
  }

  render(state: GraphView, bridge: Bridge): void {
    if (!this.covers(state)) this.query(state, bridge);
    this.world.position.set(state.viewport.x, state.viewport.y);
    this.world.scale.set(state.viewport.scale);
    this.renders += 1;
  }

  /** Whether what the scene last queried for still holds everything the viewport shows, at about
   *  its scale: nothing in the graph changed, and the viewport lies within the queried rectangle,
   *  margin included. A pan within the margin then moves the world alone. */
  private covers(state: GraphView): boolean {
    const { drawn } = this;
    if (!drawn) return false;
    const { width, height } = this.app.screen;
    const { scale } = state.viewport;
    return (
      drawn.positionsVersion === state.positionsVersion &&
      drawn.nodes === state.nodes &&
      drawn.edges === state.edges &&
      drawn.selection === state.selection &&
      drawn.level === levelAt(scale) &&
      scale <= drawn.scale * RESCALE &&
      scale >= drawn.scale / RESCALE &&
      within(worldRect(state.viewport, width, height), drawn.rect) &&
      within(drawn.rect, worldRect(state.viewport, width, height, 2 * CULLING_MARGIN))
    );
  }

  private query(state: GraphView, bridge: Bridge): void {
    const { width, height } = this.app.screen;
    const rect = worldRect(state.viewport, width, height, CULLING_MARGIN);
    const { scale } = state.viewport;
    const level = levelAt(scale);
    const far = level === "far";
    const stroke = {
      tolerance: FLATNESS / scale,
      width: far ? FAR_EDGE_WIDTH / scale : EDGE_WIDTH,
      plain: far,
    };
    // Every view of the query is read before the next call into the engine (ADR-0010).
    const visible = bridge.query(rect, this.labels.reach, stroke);
    this.nodes.sync(state, far ? NONE : visible.nodes, visible.positions);
    this.particles.sync(state, far ? visible.nodes : NONE, visible.positions);
    this.edges.sync(state, visible);
    this.labels.sync(state, visible, level === "near");
    this.level = level;
    this.queries += 1;
    const { nodes, edges, selection, positionsVersion } = state;
    this.drawn = { rect, scale, level, nodes, edges, selection, positionsVersion };
  }

  inspect(): SceneSnapshot {
    return {
      renderer: this.app.renderer.name,
      viewport: { x: this.world.x, y: this.world.y, scale: this.world.scale.x },
      level: this.level,
      nodes: [
        ...this.nodes.children.map((view) => ({
          id: (view as NodeGraphic).nodeId,
          ...(view as NodeGraphic).size,
          x: view.x,
          y: view.y,
        })),
        ...this.particles.drawn(),
      ],
      particles: this.particles.particleChildren.length,
      texts: countTexts(this.world),
      highlighted:
        this.particles.highlighted ??
        (this.nodes.children as NodeGraphic[]).find((view) => view.selected)?.nodeId ??
        null,
      edges: this.edges.drawn(),
      edgeTriangles: this.edges.triangles(),
      edgeLabels: this.labels.children.map((label) => ({
        edge: label.label,
        x: label.x,
        y: label.y,
      })),
      displayObjects: countDisplayObjects(this.world),
      renders: this.renders,
      queries: this.queries,
    };
  }
}
