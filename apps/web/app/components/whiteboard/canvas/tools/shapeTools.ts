import { Ellipse as FabricEllipse, Line as FabricLine, Rect as FabricRect } from "fabric";
import { newShapeId } from "../../lib/shape";
import type { FabricObj } from "../../types";
import type { CanvasContext } from "../context";

/**
 * Drag-to-draw tools: rect, circle, line.
 *
 * Adding another one means adding a branch to `startShape` and `resizeShape`
 * plus an entry in the toolbar — nothing else in the pipeline changes.
 */

/** Called on mouse:down. Creates the object at zero size and broadcasts it. */
export function startShape(ctx: CanvasContext, pointer: { x: number; y: number }): void {
  const { canvas, style, drawing, emit } = ctx;
  const tool = style.tool.current;

  drawing.isDrawingShape.current = true;
  drawing.origin.current = { x: pointer.x, y: pointer.y };

  const sw = style.strokeWidth.current;
  let obj: FabricObj | null = null;

  if (tool === "rect") {
    obj = new FabricRect({
      left: pointer.x + sw / 2, top: pointer.y + sw / 2,
      width: 0, height: 0,
      fill: style.fill.current,
      stroke: style.stroke.current,
      strokeWidth: sw,
      strokeUniform: true,
      opacity: style.opacity.current,
      selectable: false,
    }) as FabricObj;
  } else if (tool === "circle") {
    obj = new FabricEllipse({
      left: pointer.x + sw / 2, top: pointer.y + sw / 2,
      rx: 0, ry: 0,
      fill: style.fill.current,
      stroke: style.stroke.current,
      strokeWidth: sw,
      strokeUniform: true,
      opacity: style.opacity.current,
      selectable: false,
    }) as FabricObj;
  } else if (tool === "line") {
    obj = new FabricLine([pointer.x, pointer.y, pointer.x, pointer.y], {
      // For the line tool the primary colour lives in `fill` (see TOOL_DEFAULTS).
      stroke: style.fill.current,
      strokeWidth: sw,
      opacity: style.opacity.current,
      selectable: false,
      objectCaching: false,
    }) as FabricObj;
    drawing.line.current = obj;
  }

  if (!obj) return;
  obj.shapeId = newShapeId();
  canvas.add(obj);
  drawing.activeShape.current = obj;
  emit.createShape(obj);
}

/** Called on mouse:move while dragging. Resizes the in-progress shape. */
export function resizeShape(ctx: CanvasContext, pointer: { x: number; y: number }): void {
  const { canvas, style, drawing } = ctx;
  const origin = drawing.origin.current;
  if (!origin) return;
  const { x: ox, y: oy } = origin;
  const tool = style.tool.current;

  if (tool === "rect" && drawing.activeShape.current) {
    const r = drawing.activeShape.current;
    const sw = r.strokeWidth ?? 0;
    r.set({
      left: Math.min(ox, pointer.x) + sw / 2,
      top: Math.min(oy, pointer.y) + sw / 2,
      width: Math.max(0, Math.abs(pointer.x - ox) - sw),
      height: Math.max(0, Math.abs(pointer.y - oy) - sw),
    });
    canvas.renderAll();
  } else if (tool === "circle" && drawing.activeShape.current) {
    const c = drawing.activeShape.current;
    const sw = c.strokeWidth ?? 0;
    c.set({
      left: Math.min(ox, pointer.x) + sw / 2,
      top: Math.min(oy, pointer.y) + sw / 2,
      rx: Math.max(0, (Math.abs(pointer.x - ox) - sw) / 2),
      ry: Math.max(0, (Math.abs(pointer.y - oy) - sw) / 2),
    });
    canvas.renderAll();
  } else if (tool === "line" && drawing.line.current) {
    const line = drawing.line.current;
    line.x1 = ox;
    line.y1 = oy;
    line.x2 = pointer.x;
    line.y2 = pointer.y;
    line._setWidthHeight();
    line.setCoords();
    line.dirty = true;
    canvas.renderAll();
  }
}

/** Called on mouse:up. Makes the finished shape selectable and commits it. */
export function finishShape(ctx: CanvasContext): void {
  const { drawing, emit, reportShapeCount } = ctx;

  drawing.isDrawingShape.current = false;
  drawing.origin.current = null;

  const obj = drawing.activeShape.current || drawing.line.current;
  drawing.activeShape.current = null;
  drawing.line.current = null;
  if (!obj) return;

  obj.selectable = true;
  emit.liveUpdate(obj);
  reportShapeCount();
}
