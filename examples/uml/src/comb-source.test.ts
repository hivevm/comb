// The package and the class diagram are the example's claim about Comb, so they are held to Comb's
// source: the dependencies the package diagram draws are the imports between the modules of
// `packages/comb/src`, its tests left out, and the path dependencies between the crates; the
// operations and attributes the class diagram lists for `Comb` are the members of the `Comb`
// interface. The sources are read by path, never imported, since an example imports nothing of
// Comb but its entries (ADR-0030), and parsed here, not by any helper of the example's. A source
// this test reads nothing from fails it, naming the source.
// Verifies: G-12
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CLASSIFIERS } from "./class-diagram";
import { packageDiagram } from "./package-diagram";

const ROOT = resolve(import.meta.dir, "../../..");

/** A dependency between two packages, from the one that depends, with its label. */
interface Dependency {
  source: string;
  target: string;
  label: string;
}

const key = ({ source, target, label }: Dependency) => `${source} ${label} ${target}`;

/** The library's modules, the WebAssembly package its bridge loads, and the crates. */
const SRC = "packages/comb/src";
const WASM = "packages/comb/wasm";
const CRATES = "crates";
const API = `${SRC}/api/index.ts`;
/** The WebAssembly package under `packages/comb/wasm` is the build of this crate (`bun run
 *  build:engine`), so an import of it is a use of the crate. */
const WASM_CRATE = "engine-wasm";

/** Fails naming `source`, a path under `root`, where it cannot be read. */
function cannotRead(root: string, source: string, why: string): never {
  throw new Error(`${relative(root, source) || "."} ${why}, so nothing can be compared.`);
}

/** The code of a TypeScript source, its comments left out. */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The specifiers a module imports or re-exports from, statically, for its side effects, or
 *  dynamically. */
function specifiersOf(text: string): string[] {
  const code = codeOf(text);
  return [
    ...code.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\s*\(?\s*["']([^"']+)["']/g),
  ].map(([, specifier]) => specifier!);
}

/** Every file under `dir`, by its path. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** The package a path of the tree lies in, a file or a module's directory: a module, the
 *  directory under `packages/comb/src` holding it or named by it; the crate of the WebAssembly
 *  package; `undefined` for a file directly under `packages/comb/src`, an entry of the library,
 *  which is no package of the diagram; `null` for a path outside them. */
function packageAt(root: string, path: string): string | undefined | null {
  const inSrc = relative(join(root, SRC), path);
  if (!inSrc.startsWith("..")) {
    const first = inSrc.split(sep)[0]!;
    return statSync(join(root, SRC, first), { throwIfNoEntry: false })?.isDirectory()
      ? first
      : undefined;
  }
  if (!relative(join(root, WASM), path).startsWith("..")) return WASM_CRATE;
  return null;
}

/** The dependencies between the modules of `packages/comb/src` under `root`, its tests and their
 *  fixtures left out: a module's import of another, «import», or of the WebAssembly package,
 *  «use». A source of a shape this test does not read, or an import of a path that is no package,
 *  fails it. */
function moduleDependencies(root: string): Dependency[] {
  const src = join(root, SRC);
  if (!existsSync(src)) cannotRead(root, src, "is missing");
  const files = filesUnder(src).filter((file) => !/\.(test|fixture)\.ts$/.test(file));
  const other = files.find((file) => !file.endsWith(".ts"));
  if (other) cannotRead(root, other, "is a source of a shape this test does not read");
  const modules = files.filter((file) => packageAt(root, file) !== undefined);
  if (!modules.length) cannotRead(root, src, "holds no module");
  const found = new Map<string, Dependency>();
  for (const file of modules) {
    const source = packageAt(root, file)!;
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const path = resolve(dirname(file), specifier);
      const target = packageAt(root, path);
      if (!target)
        throw new Error(
          `${relative(root, file)} imports ${specifier}, which lies in no package of Comb.`,
        );
      if (target === source) continue;
      const dependency = {
        source,
        target,
        label: target === WASM_CRATE ? "«use»" : "«import»",
      };
      found.set(key(dependency), dependency);
    }
  }
  return [...found.values()];
}

/** The dependencies between the crates under `root`: each crate's dependency, under
 *  `[dependencies]` of its `Cargo.toml`, on a crate by its path, «use». */
function crateDependencies(root: string): Dependency[] {
  const crates = join(root, CRATES);
  if (!existsSync(crates)) cannotRead(root, crates, "is missing");
  const manifests = readdirSync(crates)
    .map((name) => join(crates, name, "Cargo.toml"))
    .filter((manifest) => existsSync(manifest));
  if (!manifests.length) cannotRead(root, crates, "holds no crate");
  return manifests.flatMap((manifest) => {
    const text = readFileSync(manifest, "utf8").replace(/#.*$/gm, "");
    const section = /^\[dependencies\][^\S\n]*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
    if (!section) cannotRead(root, manifest, "has no [dependencies]");
    return [...section[1]!.matchAll(/\bpath\s*=\s*"([^"]+)"/g)].map(([, path]) => ({
      source: dirname(relative(crates, manifest)),
      target: relative(crates, resolve(dirname(manifest), path!)),
      label: "«use»",
    }));
  });
}

/** The packages of the tree under `root`: the modules of `packages/comb/src` and the crates. */
function packagesOf(root: string): string[] {
  const directories = (dir: string) =>
    readdirSync(join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  return [...directories(SRC), ...directories(CRATES)];
}

/** Where the dependencies drawn differ from those of the source: each one missing, naming both
 *  ends, and each one drawn that the source has not. */
function dependencyDrift(read: Dependency[], drawn: Dependency[]): string[] {
  const has = (list: Dependency[], dependency: Dependency) =>
    list.some((each) => key(each) === key(dependency));
  const ends = ({ source, target, label }: Dependency) =>
    `${source} depending on ${target} (${label})`;
  return [
    ...read
      .filter((dependency) => !has(drawn, dependency))
      .map((dependency) => `the package diagram does not show ${ends(dependency)}`),
    ...drawn
      .filter((dependency) => !has(read, dependency))
      .map((dependency) => `the package diagram shows ${ends(dependency)}, which Comb has not`),
  ];
}

/** Where the packages drawn differ from those of the source. */
function packageDrift(source: string[], drawn: string[]): string[] {
  return [
    ...source
      .filter((name) => !drawn.includes(name))
      .map((name) => `${name} is a package the package diagram does not show`),
    ...drawn
      .filter((name) => !source.includes(name))
      .map((name) => `the package diagram shows ${name}, which is no package of Comb`),
  ];
}

/** A member of an interface: an operation, called, or an attribute. */
interface Member {
  name: string;
  operation: boolean;
}

/** The members of `export interface <name>` in the TypeScript `text`: each member at the
 *  indentation of two spaces, read-only or not, an operation where it takes arguments. */
function membersOf(text: string, name: string): Member[] {
  const lines = codeOf(text).split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^export interface ${name}\\b[^{]*\\{\\s*$`).test(line),
  );
  if (start < 0) return [];
  const members: Member[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("}")) break;
    const member = /^ {2}(?:readonly |get |set )?([A-Za-z_$][\w$]*)\??\s*([(:<])/.exec(line);
    if (member) members.push({ name: member[1]!, operation: member[2] !== ":" });
  }
  return members;
}

/** The members of `Comb` in the api under `root`. */
function combMembers(root: string): Member[] {
  const api = join(root, API);
  if (!existsSync(api)) cannotRead(root, api, "is missing");
  const members = membersOf(readFileSync(api, "utf8"), "Comb");
  if (!members.length) cannotRead(root, api, "declares no member of an interface Comb");
  return members;
}

/** The name a member of the class diagram is written with: after its visibility, before its
 *  arguments or its type. */
const nameOf = (written: string) => /^[+\-#~]?\s*([A-Za-z_$][\w$]*)/.exec(written)?.[1] ?? written;

/** Where the members the class diagram lists for `Comb` differ from those of the interface. */
function memberDrift(read: Member[], operations: string[], attributes: string[]): string[] {
  const drift: string[] = [];
  for (const [operation, listed, as] of [
    [true, operations.map(nameOf), "operation"],
    [false, attributes.map(nameOf), "attribute"],
  ] as const) {
    const own = read.filter((member) => member.operation === operation).map(({ name }) => name);
    for (const missing of own.filter((name) => !listed.includes(name)))
      drift.push(`Comb's member ${missing} is not an ${as} of the class diagram's Comb`);
    for (const extra of listed.filter((name) => !own.includes(name)))
      drift.push(`the class diagram's Comb lists the ${as} ${extra}, which Comb has not`);
  }
  return drift;
}

/** The dependencies the package diagram draws, read from its graph data. */
function drawnDependencies(): Dependency[] {
  const { graph } = packageDiagram(() => 40);
  return graph.edges.map(({ source, target, label }) => ({
    source,
    target,
    label: label?.text ?? "",
  }));
}

describe("against Comb's source", () => {
  test("the package diagram shows Comb's modules and crates as its packages", () => {
    const drawn = packageDiagram(() => 40).graph.nodes.map(({ id }) => id);
    expect(drawn.length).toBeGreaterThan(0);
    expect(packageDrift(packagesOf(ROOT), drawn)).toEqual([]);
  });

  test("the package diagram draws the dependencies of Comb's modules and crates", () => {
    const drawn = drawnDependencies();
    expect(drawn.length).toBeGreaterThan(0);
    const source = [...moduleDependencies(ROOT), ...crateDependencies(ROOT)];
    expect(dependencyDrift(source, drawn)).toEqual([]);
  });

  test("the class diagram's Comb lists the members of the interface Comb", () => {
    const comb = CLASSIFIERS.find(({ id }) => id === "Comb");
    expect(comb).toBeDefined();
    expect(memberDrift(combMembers(ROOT), comb!.operations, comb!.attributes)).toEqual([]);
  });
});

/** Fixture trees, each in a directory of its own under the system's temporary directory. */
const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A tree of `files`, by their path and text. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "comb-source-"));
  fixtures.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const ENGINE = { "crates/engine/Cargo.toml": '[package]\nname = "e"\n\n[dependencies]\n' };

describe("the package diagram, on fixtures", () => {
  test("a module's import of a module the diagram does not show fails naming both", () => {
    const root = tree({
      [`${SRC}/api/index.ts`]: 'import { a } from "../render/scene";\nexport const b = a;\n',
      [`${SRC}/render/scene.ts`]: 'import type { C } from "../bridge";\nexport const a = 1;\n',
      [`${SRC}/bridge/index.ts`]: 'export * from "../../wasm/glue.js";\n',
    });
    const drawn = [
      { source: "render", target: "bridge", label: "«import»" },
      { source: "bridge", target: "engine-wasm", label: "«use»" },
    ];
    expect(dependencyDrift(moduleDependencies(root), drawn)).toEqual([
      "the package diagram does not show api depending on render («import»)",
    ]);
  });

  test("a dependency the diagram shows that the source has not fails naming both", () => {
    const root = tree({ [`${SRC}/store/index.ts`]: "export const a = 1;\n", ...ENGINE });
    const drawn = [{ source: "store", target: "bridge", label: "«import»" }];
    expect(dependencyDrift(moduleDependencies(root), drawn)).toEqual([
      "the package diagram shows store depending on bridge («import»), which Comb has not",
    ]);
  });

  test("a dependency the diagram draws with another label fails naming both and both labels", () => {
    const root = tree({
      [`${SRC}/api/index.ts`]: 'import { a } from "../store";\nexport const b = a;\n',
      [`${SRC}/store/index.ts`]: "export const a = 1;\n",
    });
    const drawn = [{ source: "api", target: "store", label: "«use»" }];
    expect(dependencyDrift(moduleDependencies(root), drawn).sort()).toEqual([
      "the package diagram does not show api depending on store («import»)",
      "the package diagram shows api depending on store («use»), which Comb has not",
    ]);
  });

  test("a crate's dependency by path is a «use»; others and dev-dependencies are none", () => {
    const root = tree({
      ...ENGINE,
      "crates/engine-wasm/Cargo.toml":
        '[dependencies]\ncomb-engine = { path = "../engine" }\nserde = "1"\n' +
        '# other = { path = "../commented" }\n\n[dev-dependencies]\nx = { path = "../x" }\n',
    });
    expect(crateDependencies(root)).toEqual([
      { source: "engine-wasm", target: "engine", label: "«use»" },
    ]);
  });

  test("tests, fixtures, entries, comments, and outside packages count for nothing", () => {
    const root = tree({
      [`${SRC}/index.ts`]: 'export { a } from "./api";\n',
      [`${SRC}/api/index.ts`]: '// import "../render";\nimport "pixi.js";\nexport const a = 1;\n',
      [`${SRC}/api/index.test.ts`]: 'import "../render";\n',
      [`${SRC}/api/trap.fixture.ts`]: 'import "../render";\n',
      [`${SRC}/render/index.ts`]: "export const r = 1;\n",
    });
    expect(moduleDependencies(root)).toEqual([]);
  });
});

describe("the class diagram and what cannot be read, on fixtures", () => {
  test("a member of Comb the class diagram's Comb does not list fails naming the member", () => {
    const api =
      "export interface Comb {\n  /** Loads. */\n  load(graph: GraphData): void;\n" +
      "  fitView(): void;\n  readonly zoom: number;\n}\n";
    const source = membersOf(api, "Comb");
    expect(memberDrift(source, ["+load(graph: GraphData)"], ["+zoom: number"])).toEqual([
      "Comb's member fitView is not an operation of the class diagram's Comb",
    ]);
    expect(memberDrift(source, ["+load()", "+fitView()", "+pan()"], ["+zoom"])).toEqual([
      "the class diagram's Comb lists the operation pan, which Comb has not",
    ]);
  });

  test("a source that is missing or yields nothing fails naming it", () => {
    const empty = tree({ "README.md": "" });
    expect(() => moduleDependencies(empty)).toThrow(`${SRC} is missing`);
    expect(() => crateDependencies(empty)).toThrow(`${CRATES} is missing`);
    expect(() => combMembers(empty)).toThrow(`${API} is missing`);

    const hollow = tree({
      [`${SRC}/index.ts`]: "export {};\n",
      "crates/README.md": "",
    });
    expect(() => moduleDependencies(hollow)).toThrow(`${SRC} holds no module`);
    expect(() => crateDependencies(hollow)).toThrow(`${CRATES} holds no crate`);
    const other = tree({ [API]: "export interface Other {\n  a(): void;\n}\n" });
    expect(() => combMembers(other)).toThrow(`${API} declares no member of an interface Comb`);

    const odd = tree({
      [`${SRC}/api/view.tsx`]: "",
      "crates/engine/Cargo.toml": '[package]\nname = "e"\n',
    });
    expect(() => moduleDependencies(odd)).toThrow(
      `${SRC}/api/view.tsx is a source of a shape this test does not read`,
    );
    expect(() => crateDependencies(odd)).toThrow("crates/engine/Cargo.toml has no [dependencies]");
  });

  test("an import of a path in no package fails naming the module and the path", () => {
    const root = tree({ [`${SRC}/api/index.ts`]: 'import "../../../elsewhere";\n' });
    expect(() => moduleDependencies(root)).toThrow(
      `${SRC}/api/index.ts imports ../../../elsewhere, which lies in no package of Comb.`,
    );
  });
});
