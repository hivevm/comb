// The package diagram of the example (G-12): Comb's modules and crates as packages, each a node of
// the caption «package» and its name, and the dependencies between them as dashed edges with an
// arrowhead and the label «import», a module's import of another, or «use», the bridge's load of
// the WebAssembly package and the bridge crate's use of the core. They are the imports of
// `packages/comb/src` without its tests and the dependency of `crates/engine-wasm/Cargo.toml`, as
// the layout of ADR-0030 allows them; `comb-source.test.ts` holds them to that source.
import type { Comb, EdgeData } from "comb";
import { labelOf, styleOf } from "./relationships";
import {
  laidOut,
  newClassifier,
  type Classifier,
  type DiagramData,
  type DiagramDescriptor,
} from "./shared";

/** Comb's modules, under `packages/comb/src`, and its crates, under `crates`. */
const PACKAGES = ["api", "bridge", "store", "interaction", "render", "engine-wasm", "engine"];

/** The labels of a dependency, which the legend names; the sidebar's choice of label, the options
 *  of `#dependency` in `index.html`, offers the same two. */
const LABELS = ["«import»", "«use»"] as const;

/** Each dependency, from the package that depends to the one it depends on, with its label. */
const DEPENDENCIES: [string, string, (typeof LABELS)[number]][] = [
  ["api", "interaction", "«import»"],
  ["api", "render", "«import»"],
  ["api", "store", "«import»"],
  ["api", "bridge", "«import»"],
  ["interaction", "store", "«import»"],
  ["interaction", "bridge", "«import»"],
  ["render", "store", "«import»"],
  ["render", "bridge", "«import»"],
  ["store", "bridge", "«import»"],
  ["bridge", "engine-wasm", "«use»"],
  ["engine-wasm", "engine", "«use»"],
];

/** The rows of the diagram from top to bottom, each package by its column from the left: the
 *  public interface on top, the core at the bottom. */
const ROWS: [string, number][][] = [
  [["api", 1.5]],
  [
    ["interaction", 0.5],
    ["render", 2.5],
  ],
  [
    ["store", 1],
    ["bridge", 2],
  ],
  [["engine-wasm", 2]],
  [["engine", 2]],
];

/** The edge of a dependency: a dependency's style, its label the dependency's own, leaving the
 *  bottom of its source for the top of its target, or the right of its source for the left of
 *  its target within a row. */
function edgeOf([source, target, label]: (typeof DEPENDENCIES)[number]): EdgeData {
  const within = ROWS.some(
    (row) => row.some(([id]) => id === source) && row.some(([id]) => id === target),
  );
  return {
    id: `${source}-${target}`,
    source,
    target,
    ...(within ? {} : { sourceSide: "bottom", targetSide: "top" }),
    ...styleOf("dependency"),
    label: labelOf("dependency", label),
  };
}

/** The package diagram as graph data, each node placed by the height `heightOf` gives its
 *  content, with the classifier of each node and the kind of each edge by their identifiers. */
export function packageDiagram(heightOf: Comb["heightOf"]): DiagramData {
  const classifiers = new Map(
    PACKAGES.map((name): [string, Classifier] => [name, newClassifier(name, "package", name)]),
  );
  const byId = laidOut(ROWS, classifiers, heightOf);
  const edges = DEPENDENCIES.map(edgeOf);
  return {
    graph: { nodes: PACKAGES.map((name) => byId.get(name)!), edges },
    classifiers,
    states: new Map(),
    kinds: new Map(edges.map(({ id }) => [id, "dependency"])),
  };
}

/** The package diagram as the host application chooses it: a package is edited by its name, a
 *  connection adds a dependency «use», which the sidebar makes an «import» or a «use», and the
 *  legend names the dependency by either label. */
export const PACKAGE_DIAGRAM: DiagramDescriptor = {
  id: "package",
  name: "Package diagram",
  build: packageDiagram,
  nouns: ["packages", "dependencies"],
  nodes: [{ kind: "package", name: "Package", form: "name" }],
  connected: "dependency",
  edgeForm: "import-or-use",
  selected: { node: "node", edge: "relationship" },
  legend: true,
  labels: { dependency: LABELS },
};
