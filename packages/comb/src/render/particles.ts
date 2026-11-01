// The nodes at the far level of detail (ADR-0027): one particle per node in view, a plain box
// in one ParticleContainer, without text, so that a view of the whole graph binds no display
// object per node. Every property is static: a sync uploads them once, and the frames between
// syncs upload nothing.
import { Particle, ParticleContainer, Texture } from "pixi.js";
import type { GraphView } from "../store";

/** The colour of a node drawn as a particle, and of the selected one. */
export const FAR_NODE_COLOR = 0xc3c8d1;
export const FAR_SELECTED_COLOR = 0x3b82f6;

/** The particles layer: a pooled particle for every node slot it is given. */
/** No node hidden. */
const NONE_HIDDEN: ReadonlySet<number> = new Set();

export class NodeParticles extends ParticleContainer {
  private readonly pool: Particle[] = [];
  private madeCount = 0;
  /** The slots the particles stand for, in their order, and the heights they were drawn at;
   *  grown as needed, never shrunk. */
  private slots = new Uint32Array(1024);
  private heights = new Float32Array(1024);
  private nodes: GraphView["nodes"] = [];
  /** The nodes whose particles a drag left undrawn since the last sync (ADR-0036). */
  private hidden: ReadonlySet<number> = NONE_HIDDEN;
  /** The node the last sync tinted as selected, if it drew it. */
  highlighted: string | null = null;

  constructor() {
    super({
      texture: Texture.WHITE,
      dynamicProperties: {
        position: false,
        vertex: false,
        rotation: false,
        uvs: false,
        color: false,
      },
    });
  }

  /** Places a particle at each of `slots`, sized as its node in `sizes`, its height the one its
   *  content lays out to (ADR-0013), and tinted where it is selected, and none elsewhere. */
  sync(state: GraphView, slots: Uint32Array, positions: Float32Array, sizes: Float32Array): void {
    const particles = this.particleChildren;
    if (this.slots.length < slots.length) {
      this.slots = new Uint32Array(slots.length * 2);
      this.heights = new Float32Array(slots.length * 2);
    }
    const selected = state.selection?.kind === "node" ? state.selection.id : null;
    this.highlighted = null;
    this.hidden = NONE_HIDDEN;
    particles.length = 0;
    for (const slot of slots) {
      const node = state.nodes[slot];
      if (!node) continue;
      const i = particles.length;
      this.slots[i] = slot;
      const particle = (this.pool[i] ??= this.made());
      const isSelected = node.id === selected;
      if (isSelected) this.highlighted = node.id;
      particle.tint = isSelected ? FAR_SELECTED_COLOR : FAR_NODE_COLOR;
      particle.alpha = 1;
      particle.x = positions[slot * 2]!;
      particle.y = positions[slot * 2 + 1]!;
      const height = sizes[slot * 2 + 1]!;
      this.heights[i] = height;
      particle.scaleX = node.width / Texture.WHITE.width;
      particle.scaleY = height / Texture.WHITE.height;
      particles.push(particle);
    }
    this.update();
    this.nodes = state.nodes;
  }

  /** Leaves the particles of the nodes in `hidden` undrawn, which a drag draws in its moving
   *  layer: every property is static, so this uploads them all, once a drag (ADR-0036). */
  hide(hidden: ReadonlySet<number>): void {
    this.hidden = hidden;
    const count = this.particleChildren.length;
    for (let i = 0; i < count; i++) if (hidden.has(this.slots[i]!)) this.pool[i]!.alpha = 0;
    this.update();
  }

  /** How many particles the pool has made; it makes one only for a slot beyond its size. */
  get created(): number {
    return this.madeCount;
  }

  private made(): Particle {
    this.madeCount += 1;
    return new Particle({ texture: Texture.WHITE });
  }

  /** Whether the last sync drew the node `id`, found without building `drawn`. */
  draws(id: string): boolean {
    const count = this.particleChildren.length;
    for (let i = 0; i < count; i++) {
      const slot = this.slots[i]!;
      if (!this.hidden.has(slot) && this.nodes[slot]?.id === id) return true;
    }
    return false;
  }

  /** The nodes the last sync drew, with their place and size. */
  drawn(): { id: string; x: number; y: number; width: number; height: number }[] {
    return this.particleChildren.flatMap((particle, i) => {
      const node = this.nodes[this.slots[i]!];
      if (!node || this.hidden.has(this.slots[i]!)) return [];
      return [
        { id: node.id, x: particle.x, y: particle.y, width: node.width, height: this.heights[i]! },
      ];
    });
  }
}
