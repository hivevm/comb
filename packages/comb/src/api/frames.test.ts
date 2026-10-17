import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFrames } from "./frames";

// A hand-driven requestAnimationFrame: `tick()` runs the callbacks queued for the next frame.
let queue: Map<number, FrameRequestCallback>;
let next: number;
const tick = () => {
  const due = [...queue.values()];
  queue.clear();
  due.forEach((callback) => callback(0));
};

const original = {
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
};

beforeEach(() => {
  queue = new Map();
  next = 1;
  globalThis.requestAnimationFrame = (callback) => {
    queue.set(next, callback);
    return next++;
  };
  globalThis.cancelAnimationFrame = (handle) => void queue.delete(handle);
});

afterEach(() => {
  queue.clear();
  globalThis.requestAnimationFrame = original.requestAnimationFrame;
  globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
});

describe("frames", () => {
  test("many schedules in one frame render once", () => {
    let renders = 0;
    const frames = createFrames(() => renders++);
    frames.schedule();
    frames.schedule();
    tick();
    expect(renders).toBe(1);
  });

  test("a waiter resolves a frame after the render it waits for, never before", async () => {
    const events: string[] = [];
    const frames = createFrames(() => events.push("render"));
    frames.schedule();
    const waited = frames.whenRendered().then(() => events.push("resolved"));
    tick();
    await Promise.resolve();
    expect(events).toEqual(["render"]);
    tick();
    await waited;
    expect(events).toEqual(["render", "resolved"]);
  });

  test("with nothing pending, a waiter resolves after a frame without a render", async () => {
    let renders = 0;
    const frames = createFrames(() => renders++);
    let resolved = false;
    const waited = frames.whenRendered().then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    tick();
    await waited;
    expect(resolved).toBe(true);
    expect(renders).toBe(0);
  });

  test("a render that throws still resolves its waiters", async () => {
    const frames = createFrames(() => {
      throw new Error("render failed");
    });
    frames.schedule();
    const waited = frames.whenRendered();
    expect(tick).toThrow("render failed");
    tick();
    await waited;
  });

  test("stop resolves pending waiters, cancels the render, and later waits reject", async () => {
    let renders = 0;
    const frames = createFrames(() => renders++);
    frames.schedule();
    const pending = frames.whenRendered();
    frames.stop();
    await pending;
    tick();
    expect(renders).toBe(0);
    await expect(frames.whenRendered()).rejects.toThrow("destroyed");
    frames.schedule();
    tick();
    expect(renders).toBe(0);
  });
});
