// The engine's WebAssembly, which the host application hands over (ADR-0019): Comb never
// resolves, fetches, or inlines the file itself, so the request for it is the host application's
// own and its Content Security Policy governs it (Q-6).

/** What the host application hands over as the engine: the `Response` of its own request, or a
 *  promise of one, which the browser compiles while it streams; a compiled `WebAssembly.Module`;
 *  or the bytes of the file `comb/engine.wasm`. */
export type EngineSource = Response | PromiseLike<Response> | WebAssembly.Module | BufferSource;

/** Why Comb refused the engine it was handed: none was handed over (`missing`); a string, `URL`,
 *  or `Request`, which Comb would have to fetch itself (`fetchable`); or anything else that is
 *  not a `Response`, a `WebAssembly.Module`, or an `ArrayBuffer` or a view on one (`invalid`). */
export type EngineSourceProblem = "missing" | "fetchable" | "invalid";

const MESSAGES: Record<EngineSourceProblem, string> = {
  missing: "comb: no engine; hand over comb/engine.wasm as `engine`",
  fetchable: "comb: the engine is a string, URL, or Request; fetch it and hand over the Response",
  invalid: "comb: the engine is not a Response, a WebAssembly.Module, or the bytes",
};

/** The engine handed to `createComb` is missing, something Comb would have to fetch, or nothing
 *  it can instantiate. */
export class EngineSourceError extends Error {
  constructor(readonly reason: EngineSourceProblem) {
    super(MESSAGES[reason]);
    this.name = "EngineSourceError";
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

/** Whether the initialiser would fetch `value`. */
function isFetchable(value: unknown): boolean {
  return (
    typeof value === "string" ||
    value instanceof URL ||
    (typeof Request === "function" && value instanceof Request)
  );
}

/** Whether `value` is what the initialiser instantiates without a request. */
function isInstantiable(value: unknown): boolean {
  return (
    (typeof Response === "function" && value instanceof Response) ||
    value instanceof WebAssembly.Module ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

/** The reason to refuse `value`, if any. */
function problemOf(value: unknown): EngineSourceProblem | undefined {
  if (value === undefined || value === null) return "missing";
  if (isFetchable(value)) return "fetchable";
  return isInstantiable(value) ? undefined : "invalid";
}

/** What the bridge instantiates `source` from, with a promise settled; throws an
 *  `EngineSourceError` where `source`, or what its promise resolves to, is missing, would be
 *  fetched, or is none of a `Response`, a `WebAssembly.Module`, and the bytes. */
export async function engineOf(
  source: unknown,
): Promise<Response | WebAssembly.Module | BufferSource> {
  const settled = isThenable(source) ? await source : source;
  const problem = problemOf(settled);
  if (problem) throw new EngineSourceError(problem);
  return settled as Response | WebAssembly.Module | BufferSource;
}
