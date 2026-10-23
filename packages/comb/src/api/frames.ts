// One render per animation frame, however many changes it carries. PixiJS draws the rendered scene
// on its own ticker within the next animation frame, so the waiters of a render resolve after that
// frame and never before the pixels are drawn. A render that finds the engine lost stops the
// renders: the canvas keeps its last frame, and no trap escapes the frame (ADR-0021).
import { EngineLostError } from "../bridge";

export interface Frames {
  /** Asks for a render in the next animation frame, once however often it is asked; nothing once
   *  a render found the engine lost. */
  schedule(): void;
  /** Resolves once every change scheduled before the call is drawn, or at the next frame once a
   *  render found the engine lost; rejects after `stop`. */
  whenRendered(): Promise<void>;
  /** Cancels a pending render and resolves its waiters. */
  stop(): void;
}

export function createFrames(render: () => void): Frames {
  let frame = 0;
  let stopped = false;
  let lost = false;
  let waiting: (() => void)[] = [];
  const schedule = () => {
    if (stopped || lost) return;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const done = waiting;
      waiting = [];
      try {
        render();
      } catch (error) {
        if (!(error instanceof EngineLostError)) throw error;
        lost = true;
      } finally {
        if (done.length) requestAnimationFrame(() => done.forEach((resolve) => resolve()));
      }
    });
  };
  return {
    schedule,
    whenRendered() {
      if (stopped) return Promise.reject(new Error("comb: destroyed"));
      return new Promise((resolve) => {
        // A pending render resolves its waiters; with none pending, the scene already holds every
        // change, and the next frame draws it.
        if (frame) waiting.push(resolve);
        else requestAnimationFrame(() => resolve());
      });
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      frame = 0;
      waiting.forEach((resolve) => resolve());
      waiting = [];
    },
  };
}
