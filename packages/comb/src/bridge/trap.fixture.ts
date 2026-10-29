// A trap loses the engine for the process, as for a page (ADR-0021), and Bun runs every test file
// in one process: bridge.test.ts runs this in a process of its own and reads what it prints, the
// outcome of each call after the trap.
import {
  createBridgeSync,
  EngineLostError,
  onEngineLost,
  nodeColumns,
  trapNextCall,
  type EdgeList,
  type GraphSnapshot,
} from ".";

const url = new URL("../../wasm/test-mode/engine_bg.wasm", import.meta.url);
const bridge = createBridgeSync(await Bun.file(url).arrayBuffer());
// Plain data of its own in place of a snapshot of `api/snapshot.ts` (ADR-0028), its node written
// into columns (ADR-0032).
const columns = nodeColumns(1);
columns.node("a", "a", 0, 0, 100, 50);
const edges: EdgeList = [];
const graph = { nodes: columns.columns(), edges } as GraphSnapshot;

/** How `call` ended: `ok`, the name of a typed error with the name of its cause, or the message
 *  of an untyped one. */
function outcome(call: () => unknown): string {
  try {
    call();
    return "ok";
  } catch (error) {
    if (error instanceof EngineLostError) {
      const { cause } = error;
      return `${error.name} (${cause instanceof Error ? cause.name : "no cause"})`;
    }
    return `untyped: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const told: string[] = [];
onEngineLost((error) => told.push(`before: ${error.name}`));
const before = outcome(() => bridge.loadGraph(graph));
trapNextCall();
const trap = outcome(() => bridge.loadGraph(graph));
const after = [
  outcome(() => bridge.loadGraph(graph)),
  outcome(() => bridge.positions()),
  outcome(() => bridge.textLimit()),
  outcome(() => createBridgeSync(new Uint8Array())),
];
onEngineLost((error) => told.push(`after: ${error.name}`));
console.log(JSON.stringify({ before, trap, after, told }));
