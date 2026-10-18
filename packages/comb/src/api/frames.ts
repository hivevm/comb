// One render per animation frame, however many changes it carries. PixiJS draws the rendered scene
// on its own ticker within the next animation frame, so the waiters of a render resolve after that
// frame and never before the pixels are drawn.

export interface Frames {
  /** Asks for a render in the next animation frame, once however often it is asked. */
  schedule(): void;
  /** Resolves once every change scheduled before the call is drawn; rejects after `stop`. */
  whenRendered(): Promise<void>;
  /** Cancels a pending render and resolves its waiters. */
  stop(): void;
}

export function createFrames(render: () => void): Frames {
  let frame = 0;
  let stopped = false;
  let waiting: (() => void)[] = [];
  const schedule = () => {
    if (stopped) return;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const done = waiting;
      waiting = [];
      try {
        render();
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
