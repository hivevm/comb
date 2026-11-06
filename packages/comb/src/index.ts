// The public interface of Comb.
export {
  createComb,
  EngineLostError,
  EngineSourceError,
  GraphDataError,
  IconError,
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
  IconProblem,
} from "./api";
export type {
  ContentElement,
  Dock,
  EdgeData,
  EdgeLabelData,
  EdgePatch,
  GraphData,
  NodeContent,
  NodeData,
  NodePatch,
  NodeShape,
  Selection,
  Side,
  TextRole,
  Viewport,
} from "./store";
