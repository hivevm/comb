// The guard of every input handler (API-trapped-engine-is-lost): once the engine is lost, input
// changes nothing, and no trap escapes a handler.
import { EngineLostError, refuseIfLost } from "../bridge";

/** `handler`, doing nothing once the engine is lost. */
export function untilLost<A extends unknown[]>(
  handler: (...args: A) => void,
): (...args: A) => void {
  return (...args) => {
    try {
      refuseIfLost();
      handler(...args);
    } catch (error) {
      if (!(error instanceof EngineLostError)) throw error;
    }
  };
}
