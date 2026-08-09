import { Canvas as FabricCanvas } from "fabric";
import type { RefObject } from "react";
import type { Socket } from "socket.io-client";
import { TARGET_FIND_TOLERANCE } from "../constants";
import type { WhiteboardEmitters } from "../net/emitters";
import type {
  BoardCallbacks,
  BoardElements,
  DrawingRefs,
  FabricCanvasLike,
  StyleRefs,
} from "../types";
import type { CanvasContext, CanvasFeature } from "./context";
import { registerCursorOverlay } from "./features/cursorOverlay";
import { registerMinimap } from "./features/minimap";
import { registerObjectSync } from "./features/objectSync";
import { registerPointerTools } from "./features/pointerTools";
import { registerSelectionSync } from "./features/selectionSync";
import { registerTextSync } from "./features/textSync";
import { applyToolMode } from "./toolMode";
import { createViewport } from "./viewport";

/**
 * Every canvas feature is registered here, in one list.
 *
 * Fabric calls listeners in registration order, which matters in exactly one
 * place: `registerCursorOverlay` also listens to `mouse:move` and must stay
 * ABOVE `registerPointerTools` so the cursor broadcast happens before the
 * pointer pipeline's early returns.
 */
const canvasFeatures: CanvasFeature[] = [
  registerCursorOverlay, // keep above pointerTools — see note
  registerPointerTools,
  registerMinimap,
  registerTextSync,
  registerObjectSync,
  registerSelectionSync,
];

export interface MountParams {
  canvasEl: HTMLCanvasElement;
  socket: Socket;
  emit: WhiteboardEmitters;
  elements: BoardElements;
  style: StyleRefs;
  drawing: DrawingRefs;
  suppressEmit: RefObject<boolean>;
  callbacks: BoardCallbacks;
}

export interface MountedCanvas {
  canvas: FabricCanvasLike;
  dispose(): void;
}

export function mountBoardCanvas(params: MountParams): MountedCanvas {
  const { canvasEl, socket, emit, elements, style, drawing, suppressEmit, callbacks } = params;

  const parent = canvasEl.parentElement!;
  const canvas: FabricCanvasLike = new FabricCanvas(canvasEl, {
    width: parent.clientWidth,
    height: parent.clientHeight,
    backgroundColor: "transparent",
    selection: true,
    preserveObjectStacking: true,
    targetFindTolerance: TARGET_FIND_TOLERANCE,
  });

  const ctx: CanvasContext = {
    canvas,
    socket,
    emit,
    elements,
    style,
    drawing,
    suppressEmit,
    callbacks,
    viewport: createViewport(canvas),
    applyToolMode: () => applyToolMode(canvas, style),
    reportShapeCount: () => callbacks.setShapeCount(canvas.getObjects().length),
  };

  for (const register of canvasFeatures) register(ctx);

  const onResize = () => {
    canvas.setDimensions({ width: parent.clientWidth, height: parent.clientHeight });
    canvas.renderAll();
  };
  window.addEventListener("resize", onResize);

  ctx.applyToolMode();

  return {
    canvas,
    dispose() {
      window.removeEventListener("resize", onResize);
      canvas.dispose();
    },
  };
}
