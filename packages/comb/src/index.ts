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
  ContentClick,
  Deletion,
  Proposal,
  EngineSource,
  EngineSourceProblem,
  GraphChange,
  GraphDataProblem,
} from "./api";
export type {
  ContentElement,
  EdgeData,
  EdgeLabelData,
  EdgePatch,
  GraphData,
  NodeContent,
  NodeData,
  NodePatch,
  Selection,
  Side,
  TextRole,
  Viewport,
} from "./store";
