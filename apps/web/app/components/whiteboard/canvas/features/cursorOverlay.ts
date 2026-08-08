import { CURSOR_THROTTLE_MS } from "../../constants";
import type { FabricPointerEvent } from "../../types";
import type { CanvasContext } from "../context";

/**
 * Live cursors, outgoing half: broadcast our pointer position and keep the DOM
 * overlay that renders everyone else's cursors aligned with the Fabric
 * viewport. The incoming half is `hooks/useRemoteCursors.ts`.
 */
export function registerCursorOverlay(ctx: CanvasContext): void {
  const { canvas, elements, drawing, emit } = ctx;

  // Overlay is positioned in world coordinates, so it just mirrors the
  // canvas viewport transform.
  canvas.on("after:render", () => {
    const container = elements.cursorLayer.current;
    if (!container) return;
    const vt = canvas.viewportTransform!;
    container.style.transform = `matrix(${vt[0]},${vt[1]},${vt[2]},${vt[3]},${vt[4]},${vt[5]})`;
  });

  canvas.on("mouse:move", (opt: FabricPointerEvent) => {
    const now = Date.now();
    if (now - drawing.cursorThrottle.current < CURSOR_THROTTLE_MS) return;
    drawing.cursorThrottle.current = now;
    const cp = canvas.getScenePoint(opt.e);
    emit.cursorMove(cp.x, cp.y);
  });

  canvas.on("mouse:out", () => emit.cursorLeave());
}
