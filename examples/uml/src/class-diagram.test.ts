// The kind each classifier of the class diagram's data names against its stereotype: the kind is
// kept apart from the stereotype, so the data has to name the one its stereotype shows. The map is
// written here, not read from the example.
// Verifies: G-12
import { expect, test } from "bun:test";
import { CLASSIFIERS } from "./class-diagram";
import type { ClassifierKind } from "./shared";

/** The kind each stereotype of the data names; a «type» and no stereotype name a class. */
const KIND_OF: Record<string, ClassifierKind> = {
  "«interface»": "interface",
  "«abstract»": "abstract-class",
  "«package»": "package",
  "«type»": "class",
  "": "class",
};

for (const { id, kind, stereotype = "" } of CLASSIFIERS)
  test(`${id}, of the stereotype "${stereotype}", is of the kind it names`, () => {
    expect(kind).toBe(KIND_OF[stereotype]!);
  });
