import { Line as FabricLine, Shadow, util as fabricUtil } from "fabric";
import { LOCK_SHADOW } from "../constants";
import { isTextObject } from "../lib/shape";
import type { FabricCanvasLike, FabricObj, Shape } from "../types";

/**
 * Turning server shapes back into Fabric objects. Kept apart from the socket
 * hook because this is where all the Fabric quirks live (lines, text caching,
 * `type` being a read-only property).
 */

/** Add a shape that another client created. */
export async function addRemoteShape(canvas: FabricCanvasLike, shape: Shape): Promise<void> {
  // Lines need special handling: toObject() serialises relative coords
  // but the server stores absolute x1/y1/x2/y2 — enlivenObjects would
  // double-offset them via left/top. Create the line directly instead.
  if (shape.type === "line") {
    const l = new FabricLine([shape.x1, shape.y1, shape.x2, shape.y2], {
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      opacity: shape.opacity ?? 1,
      selectable: true,
      objectCaching: false,
    }) as FabricObj;
    l.shapeId = shape.id;
    l.__version = shape.version ?? 0;
    canvas.add(l);
    canvas.renderAll();
    return;
  }

  const objs: FabricObj[] = await fabricUtil.enlivenObjects([{ ...shape, shapeId: shape.id } as any]);
  objs.forEach((obj: FabricObj) => {
    obj.shapeId = shape.id;
    obj.__version = shape.version ?? 0;
    canvas.add(obj);
  });
  canvas.renderAll();
}

/** Apply a server-authoritative update onto an object we already have. */
export function applyRemoteShape(canvas: FabricCanvasLike, obj: FabricObj, shape: Shape): void {
  if (obj.type === "line" && shape.x1 != null) {
    // Apply absolute coords directly then call _setWidthHeight once,
    // avoiding the 4× partial-update problem from set().
    obj.x1 = shape.x1;
    obj.y1 = shape.y1;
    obj.x2 = shape.x2;
    obj.y2 = shape.y2;
    obj._setWidthHeight();
    if (shape.stroke) obj.stroke = shape.stroke;
    if (shape.strokeWidth) obj.strokeWidth = shape.strokeWidth;
    if (shape.opacity != null) obj.opacity = shape.opacity;
  } else {
    // Strip the permanent 'type' and 'version' properties — Fabric will not
    // accept them through set().
    const safeShape: Record<string, unknown> = { ...shape };
    delete safeShape.type;
    delete safeShape.version;
    obj.set(safeShape);
  }

  // Text needs an explicit assignment plus a cache invalidation, otherwise the
  // old glyphs stay on screen during a live sync.
  if (isTextObject(obj) && shape.text !== undefined) {
    obj.text = shape.text;
    obj.dirty = true;
    canvas.requestRenderAll();
  }

  obj.__version = shape.version ?? 0;
  obj.dirty = true; // invalidate object cache so Fabric redraws it
  obj.setCoords();
  canvas.renderAll();
}

/** Someone else started editing this text shape — make it untouchable and glow. */
export function lockRemoteShape(canvas: FabricCanvasLike, obj: FabricObj): void {
  obj.set({
    selectable: false,
    evented: false,
    shadow: new Shadow(LOCK_SHADOW),
  });
  canvas.renderAll();
}

export function unlockRemoteShape(canvas: FabricCanvasLike, obj: FabricObj): void {
  obj.set({ selectable: true, evented: true, shadow: null });
  canvas.renderAll();
}
