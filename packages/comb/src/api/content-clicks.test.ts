// The listeners of `onContentClick` (ADR-0013): each registration is told, the function returned
// removes it, and one that throws keeps none of the others from being told.
// Verifies: ADR-0013
import { describe, expect, test } from "bun:test";
import { contentClicksOf } from "./changes";

const CLICK = { node: "a", row: 1, column: 0, kind: "action", action: "details" } as const;

describe("onContentClick", () => {
  test("the function it returns removes the listener, and a listener added twice is told twice", () => {
    const clicks = contentClicksOf();
    const heard: string[] = [];
    const listener = () => heard.push("listener");
    const first = clicks.onContentClick(listener);
    clicks.onContentClick(listener);
    clicks.tell(CLICK);
    expect(heard).toEqual(["listener", "listener"]);
    first();
    // Removed once: the other registration of it is still told.
    first();
    clicks.tell(CLICK);
    expect(heard).toHaveLength(3);
  });

  test("each listener hears the click as it was told", () => {
    const clicks = contentClicksOf();
    const heard: unknown[] = [];
    clicks.onContentClick((click) => heard.push(click));
    clicks.tell(CLICK);
    expect(heard).toEqual([CLICK]);
  });

  test("a listener that throws keeps no other from being told, and the first error is thrown on", () => {
    const clicks = contentClicksOf();
    const heard: string[] = [];
    clicks.onContentClick(() => {
      throw new Error("first");
    });
    clicks.onContentClick(() => heard.push("second"));
    clicks.onContentClick(() => {
      throw new Error("third");
    });
    clicks.onContentClick(() => heard.push("fourth"));
    expect(() => clicks.tell(CLICK)).toThrow("first");
    expect(heard).toEqual(["second", "fourth"]);
  });
});
