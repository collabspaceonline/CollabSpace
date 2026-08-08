import { LIVE_SYNC_THROTTLE_MS } from "../../constants";
import { newShapeId } from "../../lib/shape";
import type { FabricPathEvent, FabricPointerEvent } from "../../types";
import type { CanvasContext } from "../context";
import { eraseTarget } from "../tools/eraserTool";
import { finishShape, resizeShape, startShape } from "../tools/shapeTools";
import { handleTextClick } from "../tools/textTool";

/**
 * The pointer pipeline: one mouse:down / mouse:move / mouse:up chain that
 * dispatches to the active tool.
 *
 * This stays a single file on purpose — the *order* of the checks is the
 * behaviour (pan beats everything, eraser and text return early, only the
 * drag tools fall through to the live-sync throttle). Individual tools live in
 * `canvas/tools/` and are called from here.
 */
export function registerPointerTools(ctx: CanvasContext): void {
  const { canvas, style, drawing, viewport, emit } = ctx;

  canvas.on("mouse:down", (opt: FabricPointerEvent) => {
    const me = opt.e;

    // Alt key or middle mouse button → begin pan
    if (me.altKey || me.button === 1) {
      viewport.startPan(me);
      return;
    }

    const tool = style.tool.current;
    if (tool === "select" || tool === "pen") return;

    // ERASER: erase object under cursor on click / drag
    if (tool === "eraser") {
      drawing.isErasing.current = true;
      eraseTarget(ctx, opt.target);
      return;
    }

    const pointer = canvas.getScenePoint(opt.e);

    if (tool === "text") {
      handleTextClick(ctx, pointer);
      return;
    }

    startShape(ctx, pointer);
  });

  canvas.on("mouse:move", (opt: FabricPointerEvent) => {
    if (viewport.isPanning()) {
      viewport.pan(opt.e);
      return;
    }

    const tool = style.tool.current;

    // ERASER: continuous swipe-to-erase
    if (tool === "eraser" && drawing.isErasing.current) {
      if (opt.target?.canvas) eraseTarget(ctx, opt.target);
      return;
    }

    if (!drawing.isDrawingShape.current || !drawing.origin.current) return;
    resizeShape(ctx, canvas.getScenePoint(opt.e));

    // Throttled live sync so peers see the shape grow
    const now = Date.now();
    if (now - drawing.liveThrottle.current >= LIVE_SYNC_THROTTLE_MS && drawing.activeShape.current) {
      drawing.liveThrottle.current = now;
      emit.liveUpdate(drawing.activeShape.current);
    }
  });

  canvas.on("mouse:up", () => {
    // End pan, restore cursor
    if (viewport.isPanning()) {
      viewport.endPan();
      ctx.applyToolMode();
      return;
    }

    if (style.tool.current === "eraser") {
      drawing.isErasing.current = false;
      return;
    }

    if (!drawing.isDrawingShape.current) return;
    finishShape(ctx);
  });

  // ── Pen mode: Fabric builds the path for us, we just tag and broadcast it ──
  canvas.on("path:created", (opt: FabricPathEvent) => {
    const path = opt.path;
    path.shapeId = newShapeId();
    emit.createShape(path);
    ctx.reportShapeCount();
  });
}
