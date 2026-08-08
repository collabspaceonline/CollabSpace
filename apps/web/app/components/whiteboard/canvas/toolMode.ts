import { PencilBrush } from "fabric";
import type { FabricCanvasLike, StyleRefs } from "../types";

/**
 * Translate the active tool into Fabric canvas settings: what is selectable,
 * what the cursor looks like, and whether free-drawing is on.
 *
 * A new tool needs a case here only if it changes those canvas-wide settings —
 * plain shape tools fall through to `default`.
 */
export function applyToolMode(canvas: FabricCanvasLike, style: StyleRefs): void {
  canvas.isDrawingMode = false;
  canvas.selection = true;
  canvas.skipTargetFind = false;
  canvas.defaultCursor = "default";

  switch (style.tool.current) {
    case "pen": {
      const brush = new PencilBrush(canvas);
      brush.color = style.fill.current;
      brush.width = style.strokeWidth.current;
      canvas.freeDrawingBrush = brush;
      canvas.isDrawingMode = true;
      break;
    }
    case "eraser":
      canvas.selection = false;
      canvas.defaultCursor = "cell";
      canvas.discardActiveObject();
      break;
    case "select":
      break;
    default:
      // Shape-drawing tools (rect, circle, line, text): block selecting /
      // moving existing shapes so a stray click doesn't grab them.
      canvas.selection = false;
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "crosshair";
      canvas.discardActiveObject();
      break;
  }
  canvas.renderAll();
}

/** Swap in a fresh brush when the colour or width changes mid-draw. */
export function updateBrush(canvas: FabricCanvasLike, color: string, width: number): void {
  if (!canvas.isDrawingMode) return;
  const brush = new PencilBrush(canvas);
  brush.color = color;
  brush.width = width;
  canvas.freeDrawingBrush = brush;
}
