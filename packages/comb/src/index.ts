// The public interface of Comb.
export {
  createComb,
  EngineLostError,
  EngineSourceError,
  GraphDataError,
  RendererUnavailableError,
} from "./api";
export type { Comb, CombOptions, EngineSource, EngineSourceProblem, GraphDataProblem } from "./api";
export type { EdgeData, EdgeLabelData, GraphData, NodeData, Selection, Viewport } from "./store";
