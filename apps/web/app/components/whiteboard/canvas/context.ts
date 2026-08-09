import type { RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { WhiteboardEmitters } from "../net/emitters";
import type {
  BoardCallbacks,
  BoardElements,
  DrawingRefs,
  FabricCanvasLike,
  StyleRefs,
} from "../types";
import type { ViewportController } from "./viewport";

/**
 * Everything a canvas feature is allowed to touch. Features receive this and
 * nothing else — no imports from React components, no reaching into siblings.
 */
export interface CanvasContext {
  canvas: FabricCanvasLike;
  socket: Socket;
  emit: WhiteboardEmitters;
  elements: BoardElements;
  style: StyleRefs;
  drawing: DrawingRefs;
  viewport: ViewportController;
  /** True while remote state is being applied — do not emit during that window. */
  suppressEmit: RefObject<boolean>;
  /** Always fresh: proxies to the component's current callbacks. */
  callbacks: BoardCallbacks;
  /** Re-apply selection/cursor/brush settings for the active tool. */
  applyToolMode(): void;
  /** Push the current object count back to React. */
  reportShapeCount(): void;
}

/**
 * A feature attaches its own Fabric listeners and owns one concern.
 * Register it in `canvas/mount.ts`.
 */
export type CanvasFeature = (ctx: CanvasContext) => void;
