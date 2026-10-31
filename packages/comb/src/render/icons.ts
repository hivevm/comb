// The icons the host application registered (ADR-0013): each a texture of Comb's own copy of an
// image the host application loaded itself, by the name an icon element gives, so that Comb never
// fetches an image (Q-6). A name registered again draws the new image everywhere, and its old
// texture is destroyed once the views that drew it have taken the new one.
import { ImageSource, Texture } from "pixi.js";

/** An image an icon is drawn from: Comb's own copy of what the host application registered. */
export type IconImage = HTMLCanvasElement;

/** The textures of the icons registered with one Comb, by name. */
export class Icons {
  private readonly textures = new Map<string, Texture>();
  /** The textures registered names replaced, until `release` destroys them. */
  private retired: Texture[] = [];
  /** How many times an icon was registered, so that a view draws its icons anew after one. */
  version = 0;
  /** Whether the Comb that draws them was destroyed, after which none is registered. */
  private destroyed = false;

  /** Makes `image` the texture of the icon `name`; the one it replaces is destroyed at the next
   *  `release`, since a view draws it until it takes the new one. */
  register(name: string, image: IconImage): void {
    if (this.destroyed) return;
    // A source of its own, outside PixiJS's cache, so that destroying it touches no other.
    const texture = new Texture({ source: new ImageSource({ resource: image }) });
    const replaced = this.textures.get(name);
    this.textures.set(name, texture);
    if (replaced) this.retired.push(replaced);
    this.version += 1;
  }

  /** Destroys the textures registered names replaced, once every view drawn has taken the new
   *  ones; a view bound later draws its icons anew, since `version` changed. */
  release(): void {
    for (const texture of this.retired) texture.destroy(true);
    this.retired = [];
  }

  /** The texture of the icon `name`, none where none is registered. */
  get(name: string): Texture | undefined {
    return this.textures.get(name);
  }

  /** The name `texture` is registered under, null where it is none of the registered ones. */
  nameOf(texture: Texture): string | null {
    for (const [name, registered] of this.textures) if (registered === texture) return name;
    return null;
  }

  /** Destroys every texture, when the Comb that draws them is destroyed; later registrations keep
   *  nothing. */
  destroy(): void {
    this.destroyed = true;
    this.release();
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }
}
