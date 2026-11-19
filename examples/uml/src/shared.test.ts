// The node of a name beside a border node, which the state and the activity diagram share: a
// state diagram's point and an activity diagram's pin each come with a node of its name on the
// same side, without an outline, its name one row of body text, the role a name beside a node takes
// where its node shows no title, written here rather than read from the example.
// Verifies: G-20, ARCH-border-nodes-ride-sides
import { expect, test } from "bun:test";
import type { Comb } from "comb";
import { nodesOf as activityNodesOf } from "./activity";
import { nodesOf as stateNodesOf } from "./state-diagram";

/** A height for any content, as Comb's least height of a node. */
const heightOf: Comb["heightOf"] = () => 64;

const PLACE = { attachedTo: "owner", side: "left", offset: 30, length: 200 } as const;

for (const [what, nodes] of [
  [
    "an entry point",
    stateNodesOf({ id: "p", kind: "entry-point", name: "resume" }, PLACE, heightOf),
  ],
  [
    "an input pin",
    activityNodesOf({ id: "p", kind: "input-pin", name: "resume" }, PLACE, heightOf),
  ],
] as const)
  test(`${what}'s name is a node beside it of one row of body text, without an outline`, () => {
    const name = nodes.find(({ id }) => id === "p-name");
    expect(name).toMatchObject({
      attachedTo: "owner",
      side: "left",
      outline: "none",
      content: [[{ kind: "text", role: "body", text: "resume" }]],
    });
  });
