export { default as ScreenShareButton } from "./components/ScreenShareButton";
export { default as ShareSourcePicker } from "./components/ShareSourcePicker";
export { default as PresentationStage } from "./components/PresentationStage";
export type { StagePresenter } from "./components/PresentationStage";

export { useScreenShare } from "./hooks/useScreenShare";
export { useRemotePresentations } from "./hooks/useRemotePresentations";

export { isScreenSource, isScreenVideoSource, normalizeSource } from "./lib/sources";
export { SURFACE_LABELS } from "./constants";

export type {
  MediaSource,
  Presentation,
  ScreenShareController,
  ShareSurface,
} from "./types";
