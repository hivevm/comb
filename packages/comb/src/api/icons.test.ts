// registerIcon refuses a name no icon element can give, and an image Comb would fetch, cannot
// draw, or that has not loaded, with a typed error, and fetches nothing (Q-6). The refusals that
// need a DOM image are tested in the browser, in examples/metric-tree/e2e/icons.spec.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IconError, iconOf, type IconProblem } from "./icons";

const realFetch = globalThis.fetch;
let fetched: unknown[];

beforeEach(() => {
  fetched = [];
  globalThis.fetch = ((input: unknown) => {
    fetched.push(input);
    return Promise.reject(new Error("no request in this test"));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The reason `iconOf` refuses `name` and `image` for, none where it takes them. */
function reason(name: unknown, image: unknown): IconProblem | undefined {
  try {
    iconOf(name, image, 1000);
  } catch (error) {
    expect(error).toBeInstanceOf(IconError);
    return (error as IconError).reason;
  }
  return undefined;
}

describe("an icon the host application registers", () => {
  test("a name that is no string, holds a lone surrogate, or is too long is refused", () => {
    // Verifies: ADR-0013
    const url = "https://example.test/bet.png";
    for (const name of [undefined, null, 5, {}, "b\uD800t"])
      expect(reason(name, url)).toBe("invalidName");
    expect(reason("x".repeat(1001), url)).toBe("nameTooLong");
    // The name is checked first; one of the limit is a name.
    expect(reason("x".repeat(1000), url)).toBe("fetchable");
  });

  test("a string, URL, or Request is refused and never fetched; anything else is no image", () => {
    // Verifies: ADR-0013, Q-6
    const url = "https://example.test/bet.png";
    for (const image of [url, "/bet.png", "", new URL(url), new Request(url)])
      expect(reason("bet", image)).toBe("fetchable");
    for (const image of [undefined, null, 42, { width: 16, height: 16 }, Promise.resolve(url)])
      expect(reason("bet", image)).toBe("invalid");
    expect(fetched).toEqual([]);
  });
});
