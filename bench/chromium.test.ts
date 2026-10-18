import { expect, test } from "bun:test";
import { chromiumEnv } from "./chromium";

const env = { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":1", HOME: "/home/test" };

test("headless Chromium starts without the displays, so WebGL2 runs on SwiftShader", () => {
  expect(chromiumEnv(false, env)).toEqual({ HOME: "/home/test" });
});

test("a run that opens a window keeps the displays", () => {
  expect(chromiumEnv(true, env)).toEqual(env);
});
