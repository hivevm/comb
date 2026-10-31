// The icons a host application registers (ADR-0013): an image it has loaded itself, never a URL
// Comb would fetch (Q-6), under a name an icon element of content gives.
import type { IconImage } from "../render/icons";

/** Why Comb refused an icon handed to `registerIcon`: its name is no string or holds a lone
 *  surrogate (`invalidName`), or is longer than a text of content may be (`nameTooLong`); its
 *  image is a string, `URL`, or `Request`, which Comb would have to fetch itself (`fetchable`),
 *  none of an `ImageBitmap`, an `HTMLImageElement`, and an `HTMLCanvasElement` (`invalid`), or one
 *  that holds no pixels to draw, an image that has not loaded or failed to, a closed
 *  `ImageBitmap`, or a canvas of no size (`notLoaded`). */
export type IconProblem = "invalidName" | "nameTooLong" | "fetchable" | "invalid" | "notLoaded";

const MESSAGES: Record<IconProblem, string> = {
  invalidName: "comb: an icon's name is no string, or holds a lone surrogate",
  nameTooLong: "comb: an icon's name is longer than a text of content may be",
  fetchable: "comb: the icon is a string, URL, or Request; load the image and hand it over",
  invalid: "comb: the icon is not an ImageBitmap, an HTMLImageElement, or an HTMLCanvasElement",
  notLoaded: "comb: the icon's image has not loaded, or holds no pixels",
};

/** The icon handed to `registerIcon` has a name no icon element can give, or an image Comb would
 *  have to fetch, cannot draw, or that has not loaded. */
export class IconError extends Error {
  constructor(readonly reason: IconProblem) {
    super(MESSAGES[reason]);
    this.name = "IconError";
  }
}

/** A UTF-16 code unit of a surrogate pair without its other half. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether `value` is an instance of the global `name`, where the environment has one. */
function isA(value: unknown, name: string): boolean {
  const type = (globalThis as Record<string, unknown>)[name];
  return typeof type === "function" && value instanceof (type as new () => unknown);
}

/** The reason to refuse `name` as an icon's name, a text of content holding at most `limit`
 *  UTF-16 code units, if any. */
function nameProblem(name: unknown, limit: number): IconProblem | undefined {
  if (typeof name !== "string" || LONE_SURROGATE.test(name)) return "invalidName";
  return name.length > limit ? "nameTooLong" : undefined;
}

/** The size of `image` in pixels where it is an image Comb draws, its natural size for an
 *  `HTMLImageElement` that has completed, none where it is no such image. Reads nothing that
 *  requests. */
function sizeOf(image: unknown): { width: number; height: number } | undefined {
  if (isA(image, "HTMLImageElement")) {
    const { complete, naturalWidth, naturalHeight } = image as HTMLImageElement;
    return complete ? { width: naturalWidth, height: naturalHeight } : { width: 0, height: 0 };
  }
  if (isA(image, "ImageBitmap") || isA(image, "HTMLCanvasElement")) {
    const { width, height } = image as ImageBitmap | HTMLCanvasElement;
    return { width, height };
  }
  return undefined;
}

/** The reason to refuse an icon of `name` and `image`, if any, the name before the image. */
function problemOf(name: unknown, image: unknown, limit: number): IconProblem | undefined {
  const named = nameProblem(name, limit);
  if (named) return named;
  if (typeof image === "string" || isA(image, "URL") || isA(image, "Request")) return "fetchable";
  const size = sizeOf(image);
  if (!size) return "invalid";
  return size.width > 0 && size.height > 0 ? undefined : "notLoaded";
}

/** `image` as an icon's image, with its name `name` checked; throws an `IconError` where either is
 *  refused, before anything is registered. */
export function iconOf(name: unknown, image: unknown, limit: number): IconImage {
  const problem = problemOf(name, image, limit);
  if (problem) throw new IconError(problem);
  return image as IconImage;
}
