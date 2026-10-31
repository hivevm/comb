// A click on an element of a node's content reaches the host application (ADR-0013): the engine
// answers which element lies under the pointer, a press released within the slop reports it with
// `onContentClick` and selects the node, and a press that drags moves the node and reports none.
import { expect, test, type Page } from "@playwright/test";
import type { ContentClick, NodeContent } from "comb";
import { clickWorld, loaded, node, open, pagePoint, setViewport, told } from "./shared";

/** A title row, then a body beside an action, each 94 wide with a gap of 8 in a node 220 wide:
 *  the title from (12, 10) to (208, 28), the body from (12, 28) to (106, 44), and the action from
 *  (114, 28) to (208, 44); the node is 64 high, the least height. */
const CONTENT: NodeContent = [
  [{ kind: "text", role: "title", text: "Bet" }],
  [
    { kind: "text", role: "body", text: "Body" },
    { kind: "action", text: "Details", id: "details" },
  ],
];

/** Where the action and the title lie, in world units, with node `b` at the origin. */
const ACTION: [number, number] = [150, 36];
const TITLE: [number, number] = [50, 18];

/** Opens the example on node `b` of `CONTENT` at the origin, at scale 1 from (100, 100), and
 *  records every click `onContentClick` tells into `window.clicks`. */
async function openClicks(page: Page): Promise<void> {
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: CONTENT }], edges: [] });
  await page.evaluate(() => {
    const w = window as unknown as { clicks: ContentClick[] };
    w.clicks = [];
    window.comb.onContentClick((click) => w.clicks.push(click));
  });
}

/** The clicks told since `openClicks`. */
async function clicks(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { clicks: unknown[] }).clicks);
}

/** The selection the example's last `onSelectionChange` reported. */
async function selection(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as { selections: unknown[] }).selections.at(-1));
}

test("a click on an action reports the node, its row, column, kind, and identifier, and selects the node", async ({
  page,
}) => {
  // Verifies: ADR-0013
  await openClicks(page);
  // The action is drawn as a text in the body's font, where the engine placed it.
  const texts = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes[0]!.texts!.map(({ kind, role, drawn, x, y, width }) => ({
      kind,
      role,
      drawn,
      rect: [x, y, width],
    }));
  });
  expect(texts).toEqual([
    { kind: "text", role: "title", drawn: "Bet", rect: [12, 10, 196] },
    { kind: "text", role: "body", drawn: "Body", rect: [12, 28, 94] },
    { kind: "action", role: "body", drawn: "Details", rect: [114, 28, 94] },
  ]);
  await clickWorld(page, ...ACTION);
  expect(await clicks(page)).toEqual([
    { node: "b", row: 1, column: 1, kind: "action", action: "details" },
  ]);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
  expect(await told(page)).toEqual([]);
});

test("a click on the title reports kind text and no action identifier", async ({ page }) => {
  // Verifies: ADR-0013
  await openClicks(page);
  await clickWorld(page, ...TITLE);
  expect(await clicks(page)).toEqual([{ node: "b", row: 0, column: 0, kind: "text" }]);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
});

test("a click on a badge reports kind badge, and a click beside its pill in its column none", async ({
  page,
}) => {
  // Verifies: ADR-0013
  // A title, then a badge "Done" in a column of 196: its pill from (12, 28), 22 high, as wide as
  // its text and 8 either side, far short of the column.
  await open(page);
  const content: NodeContent = [
    [{ kind: "text", role: "title", text: "Bet" }],
    [{ kind: "badge", text: "Done", color: 0x22c55e }],
  ];
  await loaded(page, { nodes: [{ ...node("b"), content }], edges: [] });
  await page.evaluate(() => {
    const w = window as unknown as { clicks: ContentClick[] };
    w.clicks = [];
    window.comb.onContentClick((click) => w.clicks.push(click));
  });
  const pill = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes[0]!.texts![1]!;
  });
  expect(pill.width).toBeLessThan(100);
  await clickWorld(page, pill.x + pill.width / 2, pill.y + pill.height / 2);
  expect(await clicks(page)).toEqual([{ node: "b", row: 1, column: 0, kind: "badge" }]);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
  // Beside the pill, in the badge's column: the node is selected, no element clicked.
  await clickWorld(page, 180, pill.y + pill.height / 2);
  expect(await clicks(page)).toHaveLength(1);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
});

test("a click on a progress bar reports kind progress, across its line above and below the bar too", async ({
  page,
}) => {
  // Verifies: ADR-0013
  // A title, then a progress bar in a column of 196: its cell from (12, 28), 196 × 16, its bar 8
  // high from 32.
  await open(page);
  const content: NodeContent = [
    [{ kind: "text", role: "title", text: "Bet" }],
    [{ kind: "progress", segments: [{ fraction: 0.4, color: 0x22c55e }] }],
  ];
  await loaded(page, { nodes: [{ ...node("b"), content }], edges: [] });
  await page.evaluate(() => {
    const w = window as unknown as { clicks: ContentClick[] };
    w.clicks = [];
    window.comb.onContentClick((click) => w.clicks.push(click));
  });
  await page.evaluate(() => window.comb.whenRendered());
  const bar = { node: "b", row: 1, column: 0, kind: "progress" };
  // On a segment, on the track, and on the line above the bar.
  await clickWorld(page, 40, 36);
  await clickWorld(page, 180, 36);
  await clickWorld(page, 100, 29.5);
  expect(await clicks(page)).toEqual([bar, bar, bar]);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
});

test("a press on an element that moves past 4 pixels drags the node and reports no click; within them it clicks", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0030
  await openClicks(page);
  const from = await pagePoint(page, ...ACTION);
  // Within the slop: released 3 pixels from the press, a click, and the node stays.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y, { steps: 3 });
  await page.mouse.up();
  expect(await clicks(page)).toHaveLength(1);
  expect(await told(page)).toEqual([]);
  // Past it: the node follows the pointer from the press, and no click.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 8 });
  await page.mouse.up();
  expect(await clicks(page)).toHaveLength(1);
  expect(await told(page)).toEqual([{ kind: "nodeMoved", by: "user", id: "b", x: 40, y: 30 }]);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
});

test("a click on the node's padding or between its elements selects the node and reports no click", async ({
  page,
}) => {
  // Verifies: ADR-0013
  await openClicks(page);
  // The left padding, the gap between the body and the action, and below the last row.
  for (const [x, y] of [
    [5, 20],
    [110, 36],
    [50, 55],
  ]) {
    await clickWorld(page, x!, y!);
    expect(await selection(page)).toEqual({ kind: "node", id: "b" });
  }
  expect(await clicks(page)).toEqual([]);
});

test("an element is clicked only where it is drawn: at the middle level the title, at the far level none", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0027
  await openClicks(page);
  await setViewport(page, { x: 100, y: 100, scale: 0.5 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("middle");
  await clickWorld(page, ...ACTION);
  await clickWorld(page, ...TITLE);
  expect(await clicks(page)).toEqual([{ node: "b", row: 0, column: 0, kind: "text" }]);
  await setViewport(page, { x: 100, y: 100, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  await clickWorld(page, ...TITLE);
  expect(await clicks(page)).toHaveLength(1);
  expect(await selection(page)).toEqual({ kind: "node", id: "b" });
});

test("a host that replaces the content when it hears of the selection hears of the element under the release", async ({
  page,
}) => {
  // Verifies: ADR-0013
  await openClicks(page);
  // Once `b` is selected, its second row holds two body texts, the action's place the second's.
  await page.evaluate(() => {
    window.comb.onSelectionChange((selected) => {
      if (selected?.kind !== "node") return;
      window.comb.updateNode(selected.id, {
        content: [
          [{ kind: "text", role: "title", text: "Bet" }],
          [
            { kind: "text", role: "body", text: "Body" },
            { kind: "text", role: "body", text: "Other" },
          ],
        ],
      });
    });
  });
  await clickWorld(page, ...ACTION);
  expect(await clicks(page)).toEqual([{ node: "b", row: 1, column: 1, kind: "text" }]);
});
