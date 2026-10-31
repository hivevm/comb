// The gestures at the fitted view, run against a viewport the fake gestures move as the page's do.
import { describe, expect, test } from "bun:test";
import { atFittedView, type View } from "./fitted";

describe("the gestures at the fitted view", () => {
  test("given the zoom cut short, the edits begin at the fitted view and record its scale", async () => {
    // Verifies: ADR-0008
    const fitted: View = { x: 310, y: 120, scale: 0.045 };
    let view = { ...fitted };
    const order: string[] = [];
    let editedAt: View | undefined;
    const result = await atFittedView(
      { read: async () => ({ ...view }), show: async (to) => void (view = { ...to }) },
      fitted,
      {
        drag: async () => (order.push("drag"), { p95: 1 }),
        pan: async () => {
          order.push("pan");
          view = { ...view, x: view.x + 200, y: view.y + 100 };
          return { p95: 2 };
        },
        // Cut short by its action budget after the first half: zoomed in, around the centre.
        zoom: async () => {
          order.push("zoom");
          view = { x: -4200, y: -2600, scale: 0.29 };
          return { p95: 3 };
        },
        edit: async () => {
          order.push("edit");
          editedAt = { ...view };
          return { p95: 4 };
        },
      },
    );
    expect(order).toEqual(["drag", "pan", "zoom", "edit"]);
    expect(editedAt).toEqual(fitted);
    expect(result).toEqual({
      drag: { p95: 1 },
      pan: { p95: 2 },
      zoom: { p95: 3 },
      edit: { p95: 4, scale: 0.045 },
    });
  });
});
