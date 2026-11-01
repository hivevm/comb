// Every error class Comb exports names itself, so that a host application's logs and `catch`
// blocks see `GraphDataError`, not `Error`.
import { describe, expect, test } from "bun:test";
import * as comb from ".";

/** How to construct each error class Comb exports, by class name. An exported error class this
 *  table lacks fails the test below, so a new one cannot slip past it. */
const ARGUMENTS: Record<string, unknown[]> = {
  EngineLostError: [],
  EngineSourceError: ["missing"],
  GraphDataError: [{ kind: "unknownNode", node: "a" }],
  IconError: ["fetchable"],
  RendererUnavailableError: ["canvas"],
};

/** Every class among Comb's exports that extends `Error`. */
const errorClasses = Object.values(comb as Record<string, unknown>).filter(
  (value): value is new (...args: unknown[]) => Error =>
    typeof value === "function" && value.prototype instanceof Error,
);

describe("exported errors", () => {
  test("Comb exports error classes, and the table names no class it does not export", () => {
    expect(errorClasses.length).toBeGreaterThan(0);
    const exported = errorClasses.map((errorClass) => errorClass.name);
    for (const name of Object.keys(ARGUMENTS)) expect(exported).toContain(name);
  });

  for (const errorClass of errorClasses) {
    test(`${errorClass.name} carries its own name`, () => {
      // Verifies: ADR-0021 (the table holds EngineLostError)
      const args = ARGUMENTS[errorClass.name];
      if (!args) throw new Error(`${errorClass.name} has no entry in the table of arguments`);
      const error = new errorClass(...args);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(errorClass.name);
    });
  }
});
