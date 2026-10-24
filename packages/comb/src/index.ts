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
  Deletion,
  Proposal,
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
  Side,
  Viewport,
} from "./store";
