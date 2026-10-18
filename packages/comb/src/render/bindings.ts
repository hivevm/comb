// The pool of a layer's views (ADR-0012): a render binds pooled views to exactly the slots the
// engine found, in slot order, and returns the others for reuse.
import type { Container } from "pixi.js";

/** A display object a layer binds to one slot at a time. */
export interface Pooled extends Container {
  /** The render that last bound it, and to which slot. */
  seen: number;
  slot: number;
}

/** Above this many views returned in one render, a layer rebuilds its children in one pass
 *  instead of removing each, which searches the children. */
const BULK_RELEASE = 64;

/** The views of one layer bound to slots: a render binds the slots it found, in ascending order,
 *  and the views of the others go back to a pool for reuse. A view draws in the order of its
 *  slot, as without pooling, so that overlapping nodes stack and take the pointer the same way
 *  however the user panned. */
export class Bindings<V extends Pooled> {
  private readonly bound = new Map<number, V>();
  private readonly free: V[] = [];
  /** The views this render bound, in slot order. */
  private readonly order: V[] = [];
  /** The highest slot among the layer's children, and whether this render bound a view below
   *  it, which an append would draw out of order. */
  private highest = -1;
  private disordered = false;
  private render = 0;
  private madeCount = 0;

  constructor(
    private readonly layer: Container,
    private readonly make: () => V,
  ) {}

  /** Starts a render. */
  begin(): void {
    this.render += 1;
    this.order.length = 0;
  }

  /** The view bound to `slot`, taken from the pool if the slot had none. Slots come in ascending
   *  order within a render. */
  bind(slot: number): V {
    let view = this.bound.get(slot);
    if (!view) {
      view = this.free.pop() ?? this.made();
      this.bound.set(slot, view);
      if (slot < this.highest) this.disordered = true;
      else this.layer.addChild(view);
    }
    view.seen = this.render;
    view.slot = slot;
    this.order.push(view);
    return view;
  }

  private made(): V {
    this.madeCount += 1;
    return this.make();
  }

  /** How many views the pool has made; it makes one only when it holds none free. */
  get created(): number {
    return this.madeCount;
  }

  /** Returns every view this render did not bind to the pool, and puts the layer's children in
   *  slot order where this render disturbed it. */
  end(): void {
    const released: V[] = [];
    for (const [slot, view] of this.bound) {
      if (view.seen === this.render) continue;
      this.bound.delete(slot);
      released.push(view);
    }
    if (this.disordered || released.length > BULK_RELEASE) {
      this.layer.removeChildren();
      for (const view of this.order) this.layer.addChild(view);
    } else {
      for (const view of released) this.layer.removeChild(view);
    }
    for (const view of released) this.free.push(view);
    this.disordered = false;
    this.highest = this.order.at(-1)?.slot ?? -1;
  }
}
