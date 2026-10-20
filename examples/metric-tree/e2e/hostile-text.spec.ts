import { expect, test } from "@playwright/test";

/** Titles and labels that a browser would run as script, load, or follow, were they ever parsed
 *  as markup or a URL: each handler records that it ran in `window.hostile`. */
const HOSTILE = [
  `<img src=x onerror="window.hostile.push('img')">`,
  `<script>window.hostile.push('script')</script>`,
  `<svg onload="window.hostile.push('svg')"></svg>`,
  `javascript:window.hostile.push('url')`,
  `<a href="javascript:window.hostile.push('a')">open</a>`,
  `<iframe srcdoc="<script>parent.hostile.push('iframe')</script>"></iframe>`,
  `&lt;b&gt; &amp; &#60;i&#62; &quot;"'\``,
];

/** In the page: makes a Comb in a host element of its own, loads a graph whose titles and labels
 *  are `hostile`, and watches the document from before `createComb` until after the frame and the
 *  failed request of any image the markup would load. Returns every mutation, by the name of its
 *  target and the nodes it added and removed, what ran, and what the canvas draws. */
async function drawWatched(hostile: string[]) {
  const record = window as unknown as { hostile: string[] };
  record.hostile = [];
  const host = document.createElement("div");
  host.style.cssText = "position: fixed; inset: 0; width: 1280px; height: 720px;";
  document.body.append(host);
  const name = (node: Node) =>
    node === host ? "host" : node instanceof Element ? node.localName : node.nodeName;
  const changes: { type: string; target: string; added: string[]; removed: string[] }[] = [];
  const keep = (records: MutationRecord[]) =>
    records.forEach((r) =>
      changes.push({
        type: r.type,
        target: name(r.target),
        added: [...r.addedNodes].map(name),
        removed: [...r.removedNodes].map(name),
      }),
    );
  const observer = new MutationObserver(keep);
  const all = { childList: true, subtree: true, attributes: true, characterData: true };
  observer.observe(document, all);

  const comb = await window.createComb(host);
  comb.load({
    nodes: hostile.map((title, i) => ({
      id: `n${i}`,
      title,
      x: (i % 4) * 300,
      y: Math.floor(i / 4) * 150,
      width: 220,
      height: 64,
    })),
    edges: hostile.map((text, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${(i + 1) % hostile.length}`,
      label: { text, t: 0.5, offset: 0 },
    })),
  });
  comb.fitView();
  await comb.whenRendered();
  await new Promise((resolve) => setTimeout(resolve, 250));
  keep(observer.takeRecords());
  observer.disconnect();

  const { level, nodes, edgeLabels } = window.inspect(comb);
  return {
    changes,
    ran: record.hostile,
    level,
    titles: Object.fromEntries(nodes.map((node) => [node.id, node.title])),
    labels: Object.fromEntries(edgeLabels.map((label) => [label.edge, label.text])),
  };
}

test("hostile text in titles and labels is drawn as text and adds nothing but the canvas", async ({
  page,
}) => {
  // Verifies: Q-5
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await page.waitForFunction(() => "loadReport" in window);
  await page.evaluate(() => window.loadReport);

  const drawn = await page.evaluate(drawWatched, HOSTILE);

  // No handler ran, and nothing the markup names was requested.
  expect(drawn.ran).toEqual([]);
  expect(requests.filter((path) => path === "/x")).toEqual([]);
  // The document gained one element, Comb's canvas in the host, and nothing changed but the
  // canvas's own attributes.
  expect(drawn.changes.filter((change) => change.type === "childList")).toEqual([
    { type: "childList", target: "host", added: ["canvas"], removed: [] },
  ]);
  const elsewhere = drawn.changes.filter(
    (change) => change.type !== "childList" && change.target !== "canvas",
  );
  expect(elsewhere).toEqual([]);
  // Every title and label is drawn, as its characters.
  expect(drawn.level).toBe("near");
  expect(drawn.titles).toEqual(Object.fromEntries(HOSTILE.map((title, i) => [`n${i}`, title])));
  expect(drawn.labels).toEqual(Object.fromEntries(HOSTILE.map((text, i) => [`e${i}`, text])));
});
