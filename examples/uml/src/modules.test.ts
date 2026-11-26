// The modules of the UML example: no diagram's file imports another diagram's, since what the
// diagrams share stands in a module of its own, which imports none of them, and the lookup of an
// element of the page is written once. A source exports only what another source imports, or what
// a test reaches the example by, on a list with why. Read from the sources, as the structural test
// of ARCH-one-workspace-per-example reads the imports.
// Verifies: G-12
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = import.meta.dir;
const DIAGRAMS = [
  ...["class-diagram", "package-diagram", "state-diagram", "activity-diagram"],
  ...["use-case-diagram", "notation-diagram"],
];

/** The modules `file` imports by a relative specifier, each without its "./" and extension. */
function importsOf(file: string): string[] {
  const source = readFileSync(join(SRC, file), "utf8");
  return [...source.matchAll(/\bfrom\s+"\.\/([^"]+)"/g)].map(([, name]) =>
    name!.replace(/\.ts$/, ""),
  );
}

for (const diagram of DIAGRAMS)
  test(`${diagram}.ts imports no other diagram's file`, () => {
    const others = DIAGRAMS.filter((each) => each !== diagram);
    expect(importsOf(`${diagram}.ts`).filter((name) => others.includes(name))).toEqual([]);
  });

for (const shared of ["shared", "activity"])
  test(`${shared}.ts, what diagrams share, imports no diagram's file`, () => {
    expect(importsOf(`${shared}.ts`).filter((name) => DIAGRAMS.includes(name))).toEqual([]);
  });

test("the lookup of an element of the page is written once", () => {
  const defining = readdirSync(SRC)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => /\bfunction element\b/.test(readFileSync(join(SRC, file), "utf8")));
  expect(defining).toHaveLength(1);
});

/** The kinds of relationship of the diagrams, and with them the kinds of node, written here from
 *  the glossary, not read from the example. */
const RELATIONSHIP_KINDS = [
  ...["association", "directed-association", "generalization", "realization", "dependency"],
  ...["aggregation", "composition", "transition", "anchor"],
  ...["control-flow", "object-flow", "interrupting-edge", "exception-handler"],
  ...["include", "extend", "use-case-generalization"],
];
const KINDS = [
  ...["class", "interface", "abstract-class", "package"],
  ...["state", "composite", "submachine", "state-list", "final"],
  ...["initial", "terminate", "choice", "junction", "fork", "join"],
  ...["shallow-history", "deep-history", "entry-point", "exit-point"],
  ...["entry-reference", "exit-reference", "send-signal", "receive-signal", "comment", "frame"],
  ...["action", "call-behavior-action", "send-signal-action", "accept-event-action"],
  ...["accept-time-event-action", "object-node", "input-pin", "output-pin", "data-store"],
  ...["central-buffer", "decision-node", "fork-node", "join-node", "interruptible-region"],
  ...["expansion-region", "expansion-node", "connector", "activity-comment", "activity-frame"],
  ...["input-parameter", "output-parameter"],
  ...["structured-node", "conditional-node", "loop-node", "value-pin", "parameter-set"],
  ...["initial-node", "activity-final", "flow-final", "merge-node"],
  ...["actor", "use-case", "subject", "use-case-comment"],
  ...RELATIONSHIP_KINDS,
];

/** The code of `file`, a path of its own or the name of a source, its comments left out. */
function codeOf(file: string): string {
  return readFileSync(resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The string literals of `file`'s code, its comments and the identifiers of the page's elements
 *  it looks up left out: a field of the sidebar may be named as a kind is. */
function literalsOf(file: string): string[] {
  const code = codeOf(file).replace(/\belement(<[^>]*>)?\("[^"]*"\)/g, "");
  return [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`$\n]*)`/g)].map(
    ([, double, single, template]) => double ?? single ?? template!,
  );
}

for (const file of ["diagram.ts", "sidebar.ts"])
  test(`${file} names no kind of node or of relationship of one diagram`, () => {
    expect(literalsOf(file).filter((literal) => KINDS.includes(literal))).toEqual([]);
  });

test("rules.ts defines no kind of node, and imports them from shared.ts", () => {
  const source = readFileSync(join(SRC, "rules.ts"), "utf8");
  expect(source).not.toMatch(/\b(CLASSIFIER|STATE|NODE)_KINDS\s*=/);
  expect(source).not.toMatch(/\btype\s+(Classifier|State|Node)Kind\s*=/);
  expect(importsOf("rules.ts")).toContain("shared");
});

/** The example's sources, its tests left out. */
const SOURCES = readdirSync(SRC).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
);

test("an edge's colour, arrowhead, and label's pill are written in relationships.ts alone", () => {
  // A colour or a pill given as a constant or a hex number, an arrowhead as a string.
  const style = /\b(?:color|background)\s*:\s*(?:0x[0-9a-fA-F]+|[A-Z][A-Z0-9_]*)\b|\barrow\s*:\s*"/;
  const writing = SOURCES.filter((file) => style.test(codeOf(file)));
  expect(writing).toEqual(["relationships.ts"]);
});

test("one function builds an edge's label, the one place that gives it its pill", () => {
  expect(codeOf("relationships.ts").match(/\bbackground\s*:/g)).toHaveLength(1);
});

test("relationships.ts names each kind of relationship once, as a key of its table", () => {
  const code = codeOf("relationships.ts");
  for (const kind of RELATIONSHIP_KINDS) {
    // As a string literal, or as a key of an object written without quotes.
    const named = code.match(new RegExp(`"${kind}"|(?<![\\w"-])${kind}\\s*:`, "g")) ?? [];
    expect({ kind, named: named.length }).toEqual({ kind, named: 1 });
  }
});

test("diagram.ts updates a node's content in one place", () => {
  expect(codeOf("diagram.ts").match(/\.updateNode\(/g)).toHaveLength(1);
});

/** The tests of the example: its unit tests beside the sources and its browser tests. */
const E2E = join(SRC, "..", "e2e");
const TESTS = [
  ...readdirSync(SRC)
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => join(SRC, file)),
  ...readdirSync(E2E)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => join(E2E, file)),
];

/** An export by a declaration of one name, the one form of export the tests below read. */
const DECLARATION =
  /^\s*export\s+(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([\w$]+)/;

/** The names `file` of the sources exports by a declaration. */
function exportsOf(file: string): string[] {
  return [...codeOf(file).matchAll(new RegExp(DECLARATION, "gm"))].map(([, name]) => name!);
}

test("each export of the sources is a declaration of one name, which the tests below read", () => {
  // Any other form, a list, a default, a re-export, or a destructuring, would pass them unread.
  const unread = SOURCES.flatMap((file) =>
    codeOf(file)
      .split("\n")
      .filter((line) => /^\s*export\b/.test(line) && !DECLARATION.test(line))
      .map((line) => `${file}: ${line.trim()}`),
  );
  expect(unread).toEqual([]);
});

/** The names the module at `path` imports by name from each of the sources, as
 *  `<file of the sources>:<name>`, an alias left out. */
function namedImportsOf(path: string): string[] {
  return [
    ...codeOf(path).matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s+"(\.[^"]+)"/g),
  ].flatMap(([, names, specifier]) => {
    const target = join(path, "..", specifier!);
    if (join(target, "..") !== SRC) return [];
    const file = `${target.slice(SRC.length + 1).replace(/\.ts$/, "")}.ts`;
    return names!
      .split(",")
      .map((name) =>
        name
          .replace(/^\s*type\s+/, "")
          .split(/\s+as\s+/)[0]!
          .trim(),
      )
      .filter(Boolean)
      .map((name) => `${file}:${name}`);
  });
}

/** The exports only tests import, each a seam the tests reach the example by, with why. */
const SEAMS: Record<string, string> = {
  "activity.ts:ACTIVITY_SHAPES": "a test matches each activity node's shape with the glossary's",
  "shared.ts:NODE_KINDS": "a test of the rules runs over every pair of kinds of node",
  "shared.ts:shownMembers": "a browser test reads which members a classifier shows",
  "class-diagram.ts:CLASSIFIERS": "tests compare the class diagram drawn with the classes it holds",
  "class-diagram.ts:RELATIONSHIPS": "a browser test counts the relationships the diagram draws",
  "activity-diagram.ts:activityDiagram": "a test builds the diagram's data without a page",
  "notation-diagram.ts:notationDiagram": "a test builds the diagram's data without a page",
  "package-diagram.ts:packageDiagram":
    "comb-source.test.ts builds the diagram's data without a page",
};

const importedBySources = new Set(SOURCES.flatMap((file) => namedImportsOf(join(SRC, file))));
const importedByTests = new Set(TESTS.flatMap(namedImportsOf));

test("every export of the sources is imported by another source, or is a seam of the tests", () => {
  const unimported = SOURCES.flatMap((file) => exportsOf(file).map((name) => `${file}:${name}`))
    .filter((qualified) => !importedBySources.has(qualified))
    .filter((qualified) => !(qualified in SEAMS));
  expect(unimported).toEqual([]);
});

test("each seam of the tests is exported, imported by a test, and by no source", () => {
  for (const seam of Object.keys(SEAMS)) {
    const [file, name] = seam.split(":") as [string, string];
    expect({ seam, exported: exportsOf(file).includes(name) }).toEqual({ seam, exported: true });
    expect({ seam, tested: importedByTests.has(seam) }).toEqual({ seam, tested: true });
    expect({ seam, sourced: importedBySources.has(seam) }).toEqual({ seam, sourced: false });
  }
});

// That the sidebar fills the select, and that a mode chosen there reaches the node, the browser
// test of an expansion region's mode in e2e/activity-edit.spec.ts decides.
test("the expansion modes are written once, and the sidebar fills its select with them", () => {
  const html = readFileSync(join(SRC, "..", "index.html"), "utf8");
  const options = html.match(/<select id="mode"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  expect(options?.trim()).toBe("");
  expect(namedImportsOf(join(SRC, "sidebar.ts"))).toContain("shared.ts:EXPANSION_MODES");
});
