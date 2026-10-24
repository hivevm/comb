// The public interface of Comb.
export {
  createComb,
  EngineLostError,
  EngineSourceError,
  GraphDataError,
  RendererUnavailableError,
} from "./api";
export type {
  Comb,
  CombOptions,
  EngineSource,
  EngineSourceProblem,
  GraphChange,
  GraphDataProblem,
} from "./api";
export type {
  EdgeData,
  EdgeLabelData,
  EdgePatch,
  GraphData,
  NodeData,
  Selection,
  Viewport,
} from "./store";
