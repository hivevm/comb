import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createComb, EngineSourceError, type CombOptions } from ".";

/** A stand-in for the host element that records what Comb adds to it. */
function fakeHost() {
  const added: unknown[] = [];
  const host = {
    appendChild: (child: unknown) => (added.push(child), child),
    append: (...children: unknown[]) => added.push(...children),
  };
  return { host: host as unknown as HTMLElement, added };
}

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

/** Calls `createComb` with `options` and returns the error it rejects with. */
async function refusal(options: unknown): Promise<{ error: unknown; added: unknown[] }> {
  const { host, added } = fakeHost();
  try {
    await createComb(host, options as CombOptions);
  } catch (error) {
    return { error, added };
  }
  throw new Error("createComb resolved");
}

describe("the engine the host application hands over", () => {
  test("without an engine, createComb refuses before it touches the host element", async () => {
    // Verifies: ADR-0019
    for (const options of [
      undefined,
      {},
      { engine: undefined },
      { engine: null },
      { engine: Promise.resolve(undefined) },
      { engine: Promise.resolve(null) },
    ]) {
      const { error, added } = await refusal(options);
      expect(error).toBeInstanceOf(EngineSourceError);
      expect((error as EngineSourceError).reason).toBe("missing");
      expect(added).toEqual([]);
    }
    expect(fetched).toEqual([]);
  });

  test("a string, URL, or Request, which would be fetched, is refused and never fetched", async () => {
    // Verifies: ADR-0019
    const url = "https://example.test/engine.wasm";
    const fetchable = [url, "/engine.wasm", new URL(url), new Request(url)];
    for (const engine of [...fetchable, ...fetchable.map((source) => Promise.resolve(source))]) {
      const { error, added } = await refusal({ engine });
      expect(error).toBeInstanceOf(EngineSourceError);
      expect((error as EngineSourceError).reason).toBe("fetchable");
      expect(added).toEqual([]);
    }
    expect(fetched).toEqual([]);
  });

  test("what is neither a Response, a module, nor the bytes is refused as invalid", async () => {
    // Verifies: ADR-0019
    for (const engine of [42, { module_or_path: "/engine.wasm" }, Promise.resolve(42)]) {
      const { error, added } = await refusal({ engine });
      expect(error).toBeInstanceOf(EngineSourceError);
      expect((error as EngineSourceError).reason).toBe("invalid");
      expect(added).toEqual([]);
    }
    expect(fetched).toEqual([]);
  });
});
