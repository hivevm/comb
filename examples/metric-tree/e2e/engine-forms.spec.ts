// The engine as the host application hands it over (ADR-0019).
import { expect, test, type Request } from "@playwright/test";
import { open } from "./shared";

test("the canvas draws from the engine in every form the host application hands over", async ({
  page,
}) => {
  // Verifies: ADR-0019
  const forms = ["", "?engine=response", "?engine=module", "?engine=bytes", "?engine=view"];
  for (const form of forms) {
    const errors: string[] = [];
    const engines: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    // Vite serves the `?url` import as a script of its own; the engine is what is fetched.
    const onRequest = (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith(".wasm") && request.resourceType() === "fetch") engines.push(path);
    };
    page.on("pageerror", onError);
    page.on("request", onRequest);
    await open(page, form);
    const drawn = await page.evaluate(() => window.inspect());
    page.off("pageerror", onError);
    page.off("request", onRequest);
    expect(errors, form).toEqual([]);
    // The example requests the file Vite emits, once, and Comb requests nothing of its own.
    expect(engines, form).toHaveLength(1);
    expect(drawn.renderer, form).toBe("webgl");
    expect(drawn.nodes, form).toHaveLength(15);
    expect(drawn.edgeTriangles, form).toBeGreaterThan(0);
  }
});
