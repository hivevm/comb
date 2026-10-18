import { describe, expect, test } from "bun:test";
import type { Comb } from "./api";
import { scenes } from "./api/scenes";
import type { Scene } from "./render/scene";
import { UncountedRendererError, work } from "./testing";

describe("work", () => {
  test("refuses, naming the renderer, where the canvas draws without WebGL", () => {
    // A canvas that draws with Canvas 2D has no WebGL context to count the calls of.
    const comb = {} as Comb;
    scenes.set(comb, { app: { renderer: { name: "canvas" } } } as unknown as Scene);
    expect(() => work(comb)).toThrow(UncountedRendererError);
    expect(() => work(comb)).toThrow(/canvas/);
  });
});
